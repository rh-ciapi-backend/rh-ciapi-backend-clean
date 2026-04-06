const { getDaysInMonth } = require('./frequenciaDayMap');

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function safeText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (text === 'undefined' || text === 'null') return '';
  return text;
}

function normalizeText(value) {
  return safeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function monthLabel(month) {
  const months = [
    '',
    'JANEIRO',
    'FEVEREIRO',
    'MARÇO',
    'ABRIL',
    'MAIO',
    'JUNHO',
    'JULHO',
    'AGOSTO',
    'SETEMBRO',
    'OUTUBRO',
    'NOVEMBRO',
    'DEZEMBRO',
  ];

  return months[Number(month)] || String(month || '');
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return '';
}

function parseNumericHours(value) {
  const text = safeText(value);
  if (!text) return null;

  const match = text.replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function formatHoursValue(value) {
  const text = safeText(value);
  if (!text) return '';

  const num = parseNumericHours(text);
  if (num === null) return text;

  if (Number.isInteger(num)) return `${num}h`;
  return `${String(num).replace('.', ',')}h`;
}

function abbreviateFacultativo(value) {
  const text = safeText(value);
  if (!text) return '';

  return text
    .replace(/PONTO\s+FACULTATIVO/gi, 'P. FACULT.')
    .replace(/PONTO\s+FAC\./gi, 'P. FACULT.')
    .replace(/P\.\s*FACULTATIVO/gi, 'P. FACULT.')
    .replace(/FACULTATIVO/gi, 'FACULT.');
}

function getServidorField(servidor = {}, keys = []) {
  const raw = servidor.raw || {};

  for (const key of keys) {
    if (servidor[key] !== undefined && servidor[key] !== null && servidor[key] !== '') {
      return servidor[key];
    }
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
      return raw[key];
    }
  }

  return '';
}

function resolveCargaHoraria(servidor = {}) {
  const chDiariaRaw = firstNonEmpty(
    getServidorField(servidor, [
      'chDiaria',
      'ch_diaria',
      'ch_diária',
      'CH_DIARIA',
      'CH_DIÁRIA',
      'c_h_diaria',
      'carga_horaria_diaria',
      'cargaHorariaDiaria',
      'carga_horaria_dia',
      'cargaHorariaDia',
      'carga_diaria',
      'horas_dia',
      'horasDia',
    ])
  );

  const chSemanalRaw = firstNonEmpty(
    getServidorField(servidor, [
      'chSemanal',
      'ch_semanal',
      'CH_SEMANAL',
      'c_h_semanal',
      'carga_horaria_semanal',
      'cargaHorariaSemanal',
      'carga_semanal',
      'carga_horaria',
      'cargaHoraria',
      'horas_semana',
      'horasSemana',
    ])
  );

  let chDiaria = formatHoursValue(chDiariaRaw);
  let chSemanal = formatHoursValue(chSemanalRaw);

  const diariaNum = parseNumericHours(chDiariaRaw);
  const semanalNum = parseNumericHours(chSemanalRaw);

  if (!chDiaria && semanalNum !== null) {
    const derived = semanalNum / 5;
    chDiaria = Number.isInteger(derived)
      ? `${derived}h`
      : `${String(derived).replace('.', ',')}h`;
  }

  if (!chSemanal && diariaNum !== null) {
    const derived = diariaNum * 5;
    chSemanal = Number.isInteger(derived)
      ? `${derived}h`
      : `${String(derived).replace('.', ',')}h`;
  }

  return {
    chDiaria,
    chSemanal,
  };
}

function normalizeServidorHeader(servidor = {}) {
  const { chDiaria, chSemanal } = resolveCargaHoraria(servidor);

  return {
    NOME: firstNonEmpty(
      getServidorField(servidor, ['nome', 'nome_completo', 'nomeCompleto'])
    ),
    MATRICULA: firstNonEmpty(
      getServidorField(servidor, ['matricula', 'registro', 'mat'])
    ),
    CPF: safeText(
      onlyDigits(
        firstNonEmpty(getServidorField(servidor, ['cpf', 'documento']))
      )
    ),
    CARGO: firstNonEmpty(
      getServidorField(servidor, ['cargo', 'funcao', 'função', 'role'])
    ),
    CATEGORIA: firstNonEmpty(
      getServidorField(servidor, ['categoria', 'categoria_canonica', 'categoriaCanonica'])
    ),
    CH_DIARIA: chDiaria,
    CH_SEMANAL: chSemanal,
    UNIDADE: firstNonEmpty(
      getServidorField(servidor, ['unidade', 'orgao', 'órgão', 'secretaria', 'setor'])
    ),
    LOTACAO: firstNonEmpty(
      getServidorField(servidor, ['lotacao', 'lotação', 'setor', 'departamento'])
    ),
  };
}

function getDayItemMap(dayItems = []) {
  const map = new Map();

  for (const item of Array.isArray(dayItems) ? dayItems : []) {
    const dia = Number(item?.dia);
    if (dia >= 1 && dia <= 31) {
      map.set(dia, item);
    }
  }

  return map;
}

function extractTextsFromDayItem(dayItem = {}) {
  const values = [
    dayItem?.rubrica,
    dayItem?.status,
    dayItem?.tipo,
    dayItem?.descricao,
    dayItem?.observacao,
    dayItem?.legenda,
    dayItem?.finalStatus,
    dayItem?.final_status,
    dayItem?.evento,
    dayItem?.eventoTipo,
    dayItem?.evento_titulo,
    dayItem?.turno1?.rubrica,
    dayItem?.turno1?.ocorrencia,
    dayItem?.turno1?.tipo,
    dayItem?.turno1?.descricao,
    dayItem?.turno2?.rubrica,
    dayItem?.turno2?.ocorrencia,
    dayItem?.turno2?.tipo,
    dayItem?.turno2?.descricao,
  ];

  return values.map(safeText).filter(Boolean);
}

function hasAny(texts, terms) {
  return texts.some((text) => {
    const normalized = normalizeText(text);
    return terms.some((term) => normalized.includes(term));
  });
}

function resolveRubrica(dayItem = {}) {
  const texts = extractTextsFromDayItem(dayItem);

  if (hasAny(texts, ['FERIAS', 'FÉRIAS'])) return 'FÉRIAS';
  if (hasAny(texts, ['PONTO FACULTATIVO', 'FACULTATIVO'])) return 'P. FACULT.';
  if (hasAny(texts, ['FERIADO'])) return 'FERIADO';
  if (hasAny(texts, ['ANIVERSARIO', 'ANIVERSÁRIO'])) return 'ANIVERSÁRIO';
  if (hasAny(texts, ['SABADO', 'SÁBADO'])) return 'SABADO';
  if (hasAny(texts, ['DOMINGO'])) return 'DOMINGO';

  return abbreviateFacultativo(
    dayItem?.rubrica || dayItem?.turno1?.rubrica || dayItem?.turno2?.rubrica || ''
  );
}

function resolveHorasPlaceholder(rubrica) {
  return rubrica ? '——' : '';
}

function resolveOcorrenciaPorTurno(turno = {}) {
  return abbreviateFacultativo(turno?.ocorrencia);
}

function buildEmptyDayPlaceholders(day) {
  return {
    [String(day)]: '',
    [`D${day}`]: '',
    [`S${day}`]: '',
    [`R${day}`]: '',
    [`T${day}`]: '',
    [`O1_${day}`]: '',
    [`O2_${day}`]: '',
    [`E1_${day}`]: '',
    [`SA1_${day}`]: '',
    [`E2_${day}`]: '',
    [`SA2_${day}`]: '',
    [`A1_${day}`]: '',
    [`A2_${day}`]: '',
    [`H1E_${day}`]: '',
    [`H1S_${day}`]: '',
    [`H2E_${day}`]: '',
    [`H2S_${day}`]: '',
  };
}

function buildDayPlaceholders(day, dayItem, totalDiasMes) {
  if (!dayItem || day > totalDiasMes) {
    return buildEmptyDayPlaceholders(day);
  }

  const turno1 = dayItem.turno1 || {};
  const turno2 = dayItem.turno2 || {};

  const rubricaDireta = resolveRubrica(dayItem);
  const horasPlaceholder = resolveHorasPlaceholder(rubricaDireta);
  const ocorrencia1 = resolveOcorrenciaPorTurno(turno1);
  const ocorrencia2 = resolveOcorrenciaPorTurno(turno2);

  return {
    [String(day)]: String(day),
    [`D${day}`]: String(day),
    [`T${day}`]: horasPlaceholder,
    [`S${day}`]: rubricaDireta,
    [`R${day}`]: rubricaDireta,
    [`O1_${day}`]: ocorrencia1,
    [`O2_${day}`]: ocorrencia2,
    [`E1_${day}`]: '',
    [`SA1_${day}`]: '',
    [`E2_${day}`]: '',
    [`SA2_${day}`]: '',
    [`A1_${day}`]: '',
    [`A2_${day}`]: '',
    [`H1E_${day}`]: '',
    [`H1S_${day}`]: '',
    [`H2E_${day}`]: '',
    [`H2S_${day}`]: '',
  };
}

function buildHiddenRowsMeta(totalDiasMes) {
  const hiddenRowsFrom = totalDiasMes + 1;
  const hiddenRowsTo = 31;

  return {
    totalDiasMes,
    hiddenRowsFrom: hiddenRowsFrom <= 31 ? hiddenRowsFrom : null,
    hiddenRowsTo: hiddenRowsFrom <= 31 ? hiddenRowsTo : null,
  };
}

function sanitizeTemplatePayload(payload = {}) {
  const clean = {};

  for (const [key, value] of Object.entries(payload || {})) {
    if (value === null || value === undefined) {
      clean[key] = '';
      continue;
    }

    if (typeof value === 'string') {
      clean[key] = abbreviateFacultativo(value);
      continue;
    }

    clean[key] = value;
  }

  return clean;
}

function buildFrequenciaTemplateData(servidor = {}, ano, mes, dayItems = []) {
  const totalDiasMes = getDaysInMonth(Number(ano), Number(mes));
  const dayMap = getDayItemMap(dayItems);
  const header = normalizeServidorHeader(servidor);

  const payload = {
    ...header,
    MES: monthLabel(mes),
    ANO: String(ano || ''),
    MES_NUMERO: String(mes || ''),
    TOTAL_DIAS_MES: totalDiasMes,
  };

  for (let day = 1; day <= 31; day += 1) {
    const dayItem = dayMap.get(day);
    Object.assign(payload, buildDayPlaceholders(day, dayItem, totalDiasMes));
  }

  Object.assign(payload, buildHiddenRowsMeta(totalDiasMes));

  return sanitizeTemplatePayload(payload);
}

module.exports = {
  buildFrequenciaTemplateData,
  monthLabel,
  sanitizeTemplatePayload,
};
