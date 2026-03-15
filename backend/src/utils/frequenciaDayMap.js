const {
  normalizeDateInput,
  isDateBetween,
  isSaturday,
  isSunday,
  buildBlankTurn,
  applyRubricaBoth,
  applyOccurrenceByTurn,
  normalizeTurno,
  classifyEventType,
  safeArray,
} = require('./frequenciaRules');

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function toISODate(year, month, day) {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

function buildInitialDayItems(year, month) {
  const totalDiasMes = getDaysInMonth(year, month);
  const dayItems = [];

  for (let dia = 1; dia <= totalDiasMes; dia += 1) {
    const data = toISODate(year, month, dia);

    dayItems.push({
      dia,
      data,
      turno1: buildBlankTurn(),
      turno2: buildBlankTurn(),
      statusFinal: '',
      sourceFlags: {
        isWeekend: false,
        isHoliday: false,
        isFacultativo: false,
        isFerias: false,
        hasAtestado: false,
        hasFalta: false,
        hasEvento: false,
      },
      sourceMeta: {
        eventos: [],
        ferias: [],
        atestados: [],
        faltas: [],
      },
    });
  }

  return dayItems;
}

function buildEventsMap(eventos) {
  const map = new Map();

  for (const ev of safeArray(eventos)) {
    const data =
      normalizeDateInput(ev.data) ||
      normalizeDateInput(ev.date) ||
      normalizeDateInput(ev.data_evento) ||
      normalizeDateInput(ev.dia);

    if (!data) continue;

    if (!map.has(data)) map.set(data, []);
    map.get(data).push(ev);
  }

  return map;
}

function applyFerias(dayItem, feriasDoServidor) {
  const feriasList = safeArray(feriasDoServidor);

  for (const ferias of feriasList) {
    const periodos = [
      {
        inicio: normalizeDateInput(ferias.periodo1_inicio),
        fim: normalizeDateInput(ferias.periodo1_fim),
      },
      {
        inicio: normalizeDateInput(ferias.periodo2_inicio),
        fim: normalizeDateInput(ferias.periodo2_fim),
      },
      {
        inicio: normalizeDateInput(ferias.periodo3_inicio),
        fim: normalizeDateInput(ferias.periodo3_fim),
      },
      // compatibilidade extra
      {
        inicio: normalizeDateInput(ferias.inicio),
        fim: normalizeDateInput(ferias.fim),
      },
      {
        inicio: normalizeDateInput(ferias.data_inicio),
        fim: normalizeDateInput(ferias.data_fim),
      },
    ];

    const hit = periodos.some(
      (p) => p.inicio && p.fim && isDateBetween(dayItem.data, p.inicio, p.fim)
    );

    if (hit) {
      dayItem.sourceFlags.isFerias = true;
      dayItem.sourceMeta.ferias.push(ferias);
      applyRubricaBoth(dayItem, 'FÉRIAS');
      return true;
    }
  }

  return false;
}

function applyCalendarEvents(dayItem, eventsMap) {
  const eventos = safeArray(eventsMap.get(dayItem.data));
  if (!eventos.length) return { feriado: false, facultativo: false };

  let feriado = false;
  let facultativo = false;

  for (const ev of eventos) {
    const tipo = classifyEventType(ev.tipo || ev.event_type || ev.categoria || ev.kind);
    const titulo = String(ev.titulo || ev.title || ev.nome || ev.descricao || '').trim();

    if (tipo === 'FERIADO') {
      feriado = true;
    } else if (tipo === 'PONTO FACULTATIVO') {
      facultativo = true;
    } else if (tipo === 'EVENTO') {
      dayItem.sourceFlags.hasEvento = true;
      dayItem.sourceMeta.eventos.push({
        ...ev,
        _normalizedType: tipo,
        _label: titulo || 'EVENTO',
      });
    }
  }

  if (feriado) {
    dayItem.sourceFlags.isHoliday = true;
    applyRubricaBoth(dayItem, 'FERIADO');
    return { feriado: true, facultativo: false };
  }

  if (facultativo) {
    dayItem.sourceFlags.isFacultativo = true;
    applyRubricaBoth(dayItem, 'PONTO FACULTATIVO');
    return { feriado: false, facultativo: true };
  }

  return { feriado: false, facultativo: false };
}

function applyWeekend(dayItem) {
  if (isSaturday(dayItem.data)) {
    dayItem.sourceFlags.isWeekend = true;
    applyRubricaBoth(dayItem, 'SABADO');
    return true;
  }

  if (isSunday(dayItem.data)) {
    dayItem.sourceFlags.isWeekend = true;
    applyRubricaBoth(dayItem, 'DOMINGO');
    return true;
  }

  return false;
}

function applyOcorrencias(dayItem, ocorrenciasDoDia) {
  const ocorrencias = safeArray(ocorrenciasDoDia);

  for (const oc of ocorrencias) {
    const tipoBruto =
      String(
        oc.tipo ||
          oc.type ||
          oc.ocorrencia_tipo ||
          oc.kind ||
          oc.status ||
          ''
      ).toUpperCase();

    const turno = normalizeTurno(oc.turno || oc.periodo || oc.shift || oc.turn || 'AMBOS');

    const isAtestado =
      tipoBruto.includes('ATESTADO') ||
      tipoBruto.includes('MEDICO') ||
      tipoBruto === 'A';

    const isFalta =
      tipoBruto.includes('FALTA') ||
      tipoBruto.includes('AUSENCIA') ||
      tipoBruto === 'F';

    if (isAtestado) {
      dayItem.sourceFlags.hasAtestado = true;
      dayItem.sourceMeta.atestados.push(oc);
      applyOccurrenceByTurn(dayItem, 'ATESTADO', turno);
      continue;
    }

    if (isFalta) {
      dayItem.sourceFlags.hasFalta = true;
      dayItem.sourceMeta.faltas.push(oc);
      applyOccurrenceByTurn(dayItem, 'FALTA', turno);
      continue;
    }
  }
}

function consolidateMonthByServidor({
  year,
  month,
  servidor,
  ferias = [],
  eventos = [],
  ocorrencias = [],
}) {
  const totalDiasMes = getDaysInMonth(year, month);
  const dayItems = buildInitialDayItems(year, month);
  const eventsMap = buildEventsMap(eventos);
  const ocorrenciasPorDia = new Map();

  for (const oc of safeArray(ocorrencias)) {
    const data =
      normalizeDateInput(oc.data) ||
      normalizeDateInput(oc.date) ||
      normalizeDateInput(oc.dia) ||
      normalizeDateInput(oc.data_ocorrencia) ||
      normalizeDateInput(oc.created_at);

    if (!data) continue;
    if (!ocorrenciasPorDia.has(data)) ocorrenciasPorDia.set(data, []);
    ocorrenciasPorDia.get(data).push(oc);
  }

  for (const dayItem of dayItems) {
    // prioridade:
    // férias
    // feriado
    // ponto facultativo
    // sábado/domingo
    // atestado/falta
    // dia normal em branco

    const hasFerias = applyFerias(dayItem, ferias);
    if (!hasFerias) {
      const evResult = applyCalendarEvents(dayItem, eventsMap);

      if (!evResult.feriado && !evResult.facultativo) {
        applyWeekend(dayItem);
      }
    }

    const ocorrenciasDoDia = ocorrenciasPorDia.get(dayItem.data) || [];
    applyOcorrencias(dayItem, ocorrenciasDoDia);
  }

  return {
    servidor,
    mes: month,
    ano: year,
    totalDiasMes,
    dayItems,
  };
}

module.exports = {
  consolidateMonthByServidor,
  getDaysInMonth,
};
