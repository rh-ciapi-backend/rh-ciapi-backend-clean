const { getDaysInMonth } = require('./frequenciaDayMap');

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
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

  return {
    [String(day)]: String(day),
    [`D${day}`]: String(day),

    // rubrica "direta" do template oficial
    [`S${day}`]: rubricaDireta,
    [`R${day}`]: rubricaDireta,

    // ocorrências por turno
    [`O1_${day}`]: ocorrencia1,
    [`O2_${day}`]: ocorrencia2,

    // aliases defensivos, caso o template use nomes alternativos
    [`T1_${day}`]: rubrica1,
    [`T2_${day}`]: rubrica2,

    // campos de batida/abono deixam vazio por enquanto
    [`E1_${day}`]: safeText(turno1.entrada),
    [`SA1_${day}`]: safeText(turno1.saida),
    [`E2_${day}`]: safeText(turno2.entrada),
    [`SA2_${day}`]: safeText(turno2.saida),
    [`A1_${day}`]: safeText(turno1.abono),
    [`A2_${day}`]: safeText(turno2.abono),
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

/**
 * Builder final do payload do template DOCX oficial
 *
 * @param {object} servidor
 * @param {number} ano
 * @param {number} mes
 * @param {Array} dayItems
 * @returns {object}
 */
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
