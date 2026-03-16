const { getDaysInMonth } = require('./frequenciaDayMap');

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function safeText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text === 'undefined' || text === 'null' ? '' : text;
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

function normalizeServidorHeader(servidor = {}) {
  return {
    NOME: safeText(servidor.nome),
    MATRICULA: safeText(servidor.matricula),
    CPF: safeText(onlyDigits(servidor.cpf)),
    CARGO: safeText(servidor.cargo),
    CATEGORIA: safeText(servidor.categoria),
    CH_DIARIA: safeText(servidor.chDiaria),
    CH_SEMANAL: safeText(servidor.chSemanal),
    UNIDADE: safeText(servidor.unidade || servidor.setor || ''),
    LOTACAO: safeText(servidor.lotacao || servidor.setor || ''),
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

function getTurnRubrica(turno) {
  return safeText(turno?.rubrica);
}

function getTurnOcorrencia(turno) {
  return safeText(turno?.ocorrencia);
}

function getTurnEntrada(turno) {
  return safeText(turno?.entrada);
}

function getTurnSaida(turno) {
  return safeText(turno?.saida);
}

function getTurnAbono(turno) {
  return safeText(turno?.abono);
}

function buildEmptyDayPlaceholders(day) {
  return {
    [String(day)]: '',
    [`D${day}`]: '',
    [`S${day}`]: '',
    [`R${day}`]: '',
    [`O1_${day}`]: '',
    [`O2_${day}`]: '',
    [`T1_${day}`]: '',
    [`T2_${day}`]: '',
    [`E1_${day}`]: '',
    [`SA1_${day}`]: '',
    [`E2_${day}`]: '',
    [`SA2_${day}`]: '',
    [`A1_${day}`]: '',
    [`A2_${day}`]: '',

    // aliases para templates variados
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

  const rubrica1 = getTurnRubrica(turno1);
  const rubrica2 = getTurnRubrica(turno2);
  const rubricaDireta = rubrica1 || rubrica2 || '';

  const ocorrencia1 = getTurnOcorrencia(turno1);
  const ocorrencia2 = getTurnOcorrencia(turno2);

  const entrada1 = getTurnEntrada(turno1);
  const saida1 = getTurnSaida(turno1);
  const entrada2 = getTurnEntrada(turno2);
  const saida2 = getTurnSaida(turno2);

  const abono1 = getTurnAbono(turno1);
  const abono2 = getTurnAbono(turno2);

  return {
    [String(day)]: String(day),
    [`D${day}`]: String(day),

    // rubrica principal
    [`S${day}`]: rubricaDireta,
    [`R${day}`]: rubricaDireta,

    // ocorrências por turno
    [`O1_${day}`]: ocorrencia1,
    [`O2_${day}`]: ocorrencia2,

    // aliases defensivos
    [`T1_${day}`]: '',
    [`T2_${day}`]: '',

    // horas e abonos - SEMPRE string vazia quando não houver valor
    [`E1_${day}`]: entrada1,
    [`SA1_${day}`]: saida1,
    [`E2_${day}`]: entrada2,
    [`SA2_${day}`]: saida2,
    [`A1_${day}`]: abono1,
    [`A2_${day}`]: abono2,

    // aliases adicionais
    [`H1E_${day}`]: entrada1,
    [`H1S_${day}`]: saida1,
    [`H2E_${day}`]: entrada2,
    [`H2S_${day}`]: saida2,
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

  return payload;
}

module.exports = {
  buildFrequenciaTemplateData,
  monthLabel,
};
