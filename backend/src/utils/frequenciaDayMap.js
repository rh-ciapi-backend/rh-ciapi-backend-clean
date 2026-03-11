'use strict';

const STATUS = {
  NORMAL: 'NORMAL',
  SABADO: 'SABADO',
  DOMINGO: 'DOMINGO',
  FERIADO: 'FERIADO',
  FERIAS: 'FERIAS',
  ATESTADO: 'ATESTADO',
  FALTA: 'FALTA',
  PONTO_FACULTATIVO: 'PONTO_FACULTATIVO',
  MANUAL: 'MANUAL'
};

const DEFAULT_PRIORITY = [
  STATUS.SABADO,
  STATUS.DOMINGO,
  STATUS.FERIADO,
  STATUS.FERIAS,
  STATUS.ATESTADO,
  STATUS.FALTA,
  STATUS.PONTO_FACULTATIVO,
  STATUS.MANUAL
];

const WEEKDAY_LABELS = [
  'DOMINGO',
  'SEGUNDA-FEIRA',
  'TERÇA-FEIRA',
  'QUARTA-FEIRA',
  'QUINTA-FEIRA',
  'SEXTA-FEIRA',
  'SÁBADO'
];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function safeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function toISODate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseISODate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }

  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    const [, d, m, y] = brMatch;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }

  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  }

  return null;
}

function dateToISO(value) {
  const dt = parseISODate(value);
  if (!dt) return null;
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function getLastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getWeekday(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function normalizeTextRubrica(status) {
  switch (status) {
    case STATUS.SABADO:
      return 'SÁBADO';
    case STATUS.DOMINGO:
      return 'DOMINGO';
    case STATUS.FERIADO:
      return 'FERIADO';
    case STATUS.FERIAS:
      return 'FÉRIAS';
    case STATUS.ATESTADO:
      return 'ATESTADO';
    case STATUS.FALTA:
      return 'FALTA';
    case STATUS.PONTO_FACULTATIVO:
      return 'PONTO FACULTATIVO';
    default:
      return '';
  }
}

function dateBetweenInclusive(dateISO, startISO, endISO) {
  if (!dateISO || !startISO || !endISO) return false;
  return dateISO >= startISO && dateISO <= endISO;
}

function normalizePeriods(periods = []) {
  return (Array.isArray(periods) ? periods : [])
    .map((item) => {
      const inicio = dateToISO(item?.inicio || item?.data_inicio || item?.start || item?.startDate);
      const fim = dateToISO(item?.fim || item?.data_fim || item?.end || item?.endDate);
      if (!inicio || !fim) return null;
      return {
        inicio,
        fim,
        tipo: safeUpper(item?.tipo || ''),
        observacao: item?.observacao || item?.descricao || '',
        turno: safeUpper(item?.turno || '')
      };
    })
    .filter(Boolean);
}

function normalizeEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .map((item) => {
      const dataISO = dateToISO(item?.data || item?.date || item?.dataISO);
      if (!dataISO) return null;

      const tipo = safeUpper(item?.tipo || item?.type);
      return {
        dataISO,
        tipo,
        titulo: item?.titulo || item?.title || '',
        descricao: item?.descricao || item?.description || ''
      };
    })
    .filter(Boolean);
}

function normalizeFaltas(faltas = []) {
  return (Array.isArray(faltas) ? faltas : [])
    .map((item) => {
      const data = dateToISO(item?.data || item?.date || item?.dataISO);
      const inicio = dateToISO(item?.inicio || item?.data_inicio || item?.start);
      const fim = dateToISO(item?.fim || item?.data_fim || item?.end);
      const turno = safeUpper(item?.turno || '');
      const tipo = safeUpper(item?.tipo || 'FALTA');

      if (data) {
        return {
          tipo,
          dataISO: data,
          turno,
          observacao: item?.observacao || item?.descricao || ''
        };
      }

      if (inicio && fim) {
        return {
          tipo,
          inicio,
          fim,
          turno,
          observacao: item?.observacao || item?.descricao || ''
        };
      }

      return null;
    })
    .filter(Boolean);
}

function normalizeManualEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((item) => {
      const dataISO = dateToISO(item?.data || item?.date || item?.dataISO);
      if (!dataISO) return null;

      return {
        dataISO,
        rubrica: item?.rubrica || '',
        rubrica1: item?.rubrica1 || '',
        rubrica2: item?.rubrica2 || '',
        ocorrencia1: item?.ocorrencia1 || item?.o1 || '',
        ocorrencia2: item?.ocorrencia2 || item?.o2 || '',
        observacoes: item?.observacoes || item?.observacao || ''
      };
    })
    .filter(Boolean);
}

function findEventByDate(events, dateISO, tipo) {
  return events.find((item) => item.dataISO === dateISO && item.tipo === tipo) || null;
}

function findPeriodByDate(periods, dateISO) {
  return periods.find((item) => dateBetweenInclusive(dateISO, item.inicio, item.fim)) || null;
}

function findFaltaByDate(faltas, dateISO) {
  return faltas.find((item) => {
    if (item.dataISO) return item.dataISO === dateISO;
    if (item.inicio && item.fim) return dateBetweenInclusive(dateISO, item.inicio, item.fim);
    return false;
  }) || null;
}

function findManualByDate(entries, dateISO) {
  return entries.find((item) => item.dataISO === dateISO) || null;
}

function chooseWinningStatus(candidates, priority = DEFAULT_PRIORITY) {
  for (const status of priority) {
    if (candidates[status]) return status;
  }
  return STATUS.NORMAL;
}

function buildDayState({
  year,
  month,
  day,
  holidays,
  pontos,
  vacations,
  atestados,
  faltas,
  manualEntries,
  includePontoFacultativo = false,
  faltaNaRubrica = true,
  priority = DEFAULT_PRIORITY
}) {
  const dataISO = toISODate(year, month, day);
  const weekday = getWeekday(year, month, day);
  const weekdayLabel = WEEKDAY_LABELS[weekday];
  const isSaturday = weekday === 6;
  const isSunday = weekday === 0;

  const holiday = findEventByDate(holidays, dataISO, 'FERIADO');
  const ponto = findEventByDate(pontos, dataISO, 'PONTO');
  const vacation = findPeriodByDate(vacations, dataISO);
  const atestado = findPeriodByDate(atestados, dataISO);
  const falta = findFaltaByDate(faltas, dataISO);
  const manual = findManualByDate(manualEntries, dataISO);

  const candidates = {
    [STATUS.SABADO]: isSaturday,
    [STATUS.DOMINGO]: isSunday,
    [STATUS.FERIADO]: !!holiday,
    [STATUS.FERIAS]: !!vacation,
    [STATUS.ATESTADO]: !!atestado,
    [STATUS.FALTA]: !!falta && !!faltaNaRubrica,
    [STATUS.PONTO_FACULTATIVO]: !!ponto && !!includePontoFacultativo,
    [STATUS.MANUAL]:
      !!safeUpper(manual?.rubrica) ||
      !!safeUpper(manual?.rubrica1) ||
      !!safeUpper(manual?.rubrica2)
  };

  const finalStatus = chooseWinningStatus(candidates, priority);

  let rubrica = '';
  let rubrica1 = '';
  let rubrica2 = '';
  let ocorrencia1 = '';
  let ocorrencia2 = '';
  let observacoes = '';

  if (finalStatus !== STATUS.NORMAL && finalStatus !== STATUS.MANUAL) {
    rubrica = normalizeTextRubrica(finalStatus);
    rubrica1 = rubrica;
    rubrica2 = rubrica;
  }

  if (finalStatus === STATUS.MANUAL && manual) {
    rubrica = manual.rubrica || manual.rubrica1 || manual.rubrica2 || '';
    rubrica1 = manual.rubrica1 || manual.rubrica || '';
    rubrica2 = manual.rubrica2 || manual.rubrica || '';
  }

  if (!rubrica && manual?.rubrica) rubrica = manual.rubrica;
  if (!rubrica1 && manual?.rubrica1) rubrica1 = manual.rubrica1;
  if (!rubrica2 && manual?.rubrica2) rubrica2 = manual.rubrica2;

  if (!rubrica && rubrica1) rubrica = rubrica1;
  if (!rubrica && rubrica2) rubrica = rubrica2;

  const bloqueiaOcorrenciaPorRubricaInstitucional =
    finalStatus === STATUS.SABADO ||
    finalStatus === STATUS.DOMINGO ||
    finalStatus === STATUS.FERIADO ||
    finalStatus === STATUS.FERIAS ||
    finalStatus === STATUS.ATESTADO ||
    finalStatus === STATUS.FALTA ||
    finalStatus === STATUS.PONTO_FACULTATIVO;

  if (!bloqueiaOcorrenciaPorRubricaInstitucional) {
    ocorrencia1 = manual?.ocorrencia1 || '';
    ocorrencia2 = manual?.ocorrencia2 || '';
  }

  const notes = [];
  if (holiday?.titulo) notes.push(`Feriado: ${holiday.titulo}`);
  if (ponto?.titulo) notes.push(`Ponto facultativo: ${ponto.titulo}`);
  if (vacation?.observacao) notes.push(vacation.observacao);
  if (atestado?.observacao) notes.push(atestado.observacao);
  if (falta?.observacao) notes.push(falta.observacao);
  if (manual?.observacoes) notes.push(manual.observacoes);

  observacoes = notes.filter(Boolean).join(' | ');

  return {
    dia: day,
    dataISO,
    weekday,
    weekdayLabel,
    isSaturday,
    isSunday,
    isHoliday: !!holiday,
    isPontoFacultativo: !!ponto && !!includePontoFacultativo,
    isVacation: !!vacation,
    isAtestado: !!atestado,
    isFalta: !!falta,
    finalStatus,
    rubrica,
    rubrica1,
    rubrica2,
    ocorrencia1,
    ocorrencia2,
    observacoes,
    holiday,
    ponto,
    vacation,
    atestado,
    falta,
    manual
  };
}

function buildMonthlyDayMap({
  year,
  month,
  events = [],
  vacations = [],
  atestados = [],
  faltas = [],
  manualEntries = [],
  includePontoFacultativo = false,
  faltaNaRubrica = true,
  priority = DEFAULT_PRIORITY
}) {
  if (!year || !month) {
    throw new Error('Parâmetros obrigatórios ausentes: year e month.');
  }

  const normalizedEvents = normalizeEvents(events);
  const holidays = normalizedEvents.filter((e) => e.tipo === 'FERIADO');
  const pontos = normalizedEvents.filter((e) => e.tipo === 'PONTO');

  const normalizedVacations = normalizePeriods(vacations);
  const normalizedAtestados = normalizePeriods(atestados);
  const normalizedFaltas = normalizeFaltas(faltas);
  const normalizedManualEntries = normalizeManualEntries(manualEntries);

  const lastDay = getLastDayOfMonth(year, month);
  const dayMap = {};

  for (let day = 1; day <= lastDay; day += 1) {
    dayMap[day] = buildDayState({
      year,
      month,
      day,
      holidays,
      pontos,
      vacations: normalizedVacations,
      atestados: normalizedAtestados,
      faltas: normalizedFaltas,
      manualEntries: normalizedManualEntries,
      includePontoFacultativo,
      faltaNaRubrica,
      priority
    });
  }

  return {
    year,
    month,
    lastDay,
    totalDays: lastDay,
    hiddenRowsFrom: lastDay + 1,
    hiddenRowsTo: 31,
    dayMap
  };
}

function buildTemplateDataFromDayMap(monthlyMap, options = {}) {
  const {
    keepWeekdayLabel = true,
    includeVisibilityFlags = true,
    fillBlankDaysUpTo31 = true
  } = options;

  const result = {};
  const lastDay = monthlyMap?.lastDay || 0;
  const dayMap = monthlyMap?.dayMap || {};

  for (let day = 1; day <= 31; day += 1) {
    const item = dayMap[day];

    if (item) {
      result[`D${day}`] = String(day);
      result[`T${day}`] = keepWeekdayLabel ? item.weekdayLabel : '';
      result[`S${day}`] = item.rubrica || '';
      result[`R1_${day}`] = item.rubrica1 || '';
      result[`R2_${day}`] = item.rubrica2 || '';
      result[`O1_${day}`] = item.ocorrencia1 || '';
      result[`O2_${day}`] = item.ocorrencia2 || '';
      result[`OBS_${day}`] = item.observacoes || '';

      if (includeVisibilityFlags) {
        result[`VIS_${day}`] = true;
        result[`SHOW_ROW_${day}`] = true;
      }
    } else if (fillBlankDaysUpTo31) {
      result[`D${day}`] = '';
      result[`T${day}`] = '';
      result[`S${day}`] = '';
      result[`R1_${day}`] = '';
      result[`R2_${day}`] = '';
      result[`O1_${day}`] = '';
      result[`O2_${day}`] = '';
      result[`OBS_${day}`] = '';

      if (includeVisibilityFlags) {
        result[`VIS_${day}`] = false;
        result[`SHOW_ROW_${day}`] = false;
      }
    }
  }

  result.LAST_DAY = lastDay;
  result.HIDE_FROM_DAY = lastDay < 31 ? lastDay + 1 : '';
  result.HAS_EXCESS_ROWS = lastDay < 31;

  return result;
}

module.exports = {
  STATUS,
  DEFAULT_PRIORITY,
  getLastDayOfMonth,
  buildMonthlyDayMap,
  buildTemplateDataFromDayMap,
  dateToISO,
  normalizeEvents,
  normalizePeriods,
  normalizeFaltas,
  normalizeManualEntries
};
