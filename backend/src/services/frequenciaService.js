'use strict';

const {
  buildMonthlyDayMap,
  buildTemplateDataFromDayMap,
  dateToISO
} = require('../utils/frequenciaDayMap');

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function monthNamePtBr(month) {
  const names = [
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
    'DEZEMBRO'
  ];
  return names[Number(month)] || '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeServidor(servidor = {}) {
  return {
    id: servidor.id || servidor.servidor || servidor.uuid || '',
    nome:
      servidor.nomeCompleto ||
      servidor.nome_completo ||
      servidor.nome ||
      servidor.servidor_nome ||
      '',
    matricula: servidor.matricula || '',
    cpf: servidor.cpf || '',
    cargo: servidor.cargo || servidor.funcao || '',
    categoria: servidor.categoria || '',
    setor: servidor.setor || servidor.lotacao || '',
    chDiaria:
      servidor.chDiaria ||
      servidor.ch_diaria ||
      servidor.cargaHorariaDiaria ||
      '',
    chSemanal:
      servidor.chSemanal ||
      servidor.ch_semanal ||
      servidor.cargaHorariaSemanal ||
      ''
  };
}

function normalizeFeriasInput(ferias = []) {
  return asArray(ferias)
    .flatMap((item) => {
      const result = [];

      const p1i = item?.periodo1_inicio || item?.inicio || item?.data_inicio || item?.startDate;
      const p1f = item?.periodo1_fim || item?.fim || item?.data_fim || item?.endDate;
      const p2i = item?.periodo2_inicio;
      const p2f = item?.periodo2_fim;
      const p3i = item?.periodo3_inicio;
      const p3f = item?.periodo3_fim;

      if (p1i && p1f) {
        result.push({
          inicio: p1i,
          fim: p1f,
          tipo: 'FERIAS',
          observacao: item?.observacao || 'Férias'
        });
      }

      if (p2i && p2f) {
        result.push({
          inicio: p2i,
          fim: p2f,
          tipo: 'FERIAS',
          observacao: item?.observacao || 'Férias'
        });
      }

      if (p3i && p3f) {
        result.push({
          inicio: p3i,
          fim: p3f,
          tipo: 'FERIAS',
          observacao: item?.observacao || 'Férias'
        });
      }

      return result;
    });
}

function normalizeAtestadosInput(atestados = []) {
  return asArray(atestados).map((item) => ({
    inicio:
      item?.inicio ||
      item?.data_inicio ||
      item?.periodo_inicio ||
      item?.dataInicial,
    fim:
      item?.fim ||
      item?.data_fim ||
      item?.periodo_fim ||
      item?.dataFinal,
    tipo: 'ATESTADO',
    observacao: item?.observacao || item?.motivo || 'Atestado'
  }));
}

function normalizeFaltasInput(faltas = []) {
  return asArray(faltas).map((item) => ({
    data: item?.data || item?.date || item?.dataISO,
    inicio: item?.inicio || item?.data_inicio,
    fim: item?.fim || item?.data_fim,
    turno: item?.turno || '',
    tipo: 'FALTA',
    observacao: item?.observacao || item?.descricao || 'Falta'
  }));
}

function normalizeEventosInput(eventos = []) {
  return asArray(eventos).map((item) => ({
    data: item?.data || item?.date || item?.dataISO,
    tipo: upper(item?.tipo || item?.type),
    titulo: item?.titulo || item?.title || '',
    descricao: item?.descricao || item?.description || ''
  }));
}

function normalizeOcorrenciasManuaisInput(ocorrencias = []) {
  return asArray(ocorrencias).map((item) => ({
    data: item?.data || item?.date || item?.dataISO,
    rubrica: item?.rubrica || '',
    rubrica1: item?.rubrica1 || '',
    rubrica2: item?.rubrica2 || '',
    ocorrencia1: item?.ocorrencia1 || item?.o1 || '',
    ocorrencia2: item?.ocorrencia2 || item?.o2 || '',
    observacoes: item?.observacoes || item?.observacao || ''
  }));
}

function buildCabecalhoPlaceholders({ servidor, year, month }) {
  const s = normalizeServidor(servidor);

  return {
    ANO: String(year),
    MES: monthNamePtBr(month),
    MES_NUMERO: pad2(month),
    NOME: s.nome || '',
    NOME_COMPLETO: s.nome || '',
    MATRICULA: s.matricula || '',
    CPF: s.cpf || '',
    CARGO: s.cargo || '',
    CATEGORIA: s.categoria || '',
    SETOR: s.setor || '',
    CH_DIARIA: s.chDiaria ? `CH_DIARIA: ${s.chDiaria}` : '',
    CH_SEMANAL: s.chSemanal ? `CH_SEMANAL: ${s.chSemanal}` : '',
    C_H_DIARIA: s.chDiaria || '',
    C_H_SEMANAL: s.chSemanal || ''
  };
}

function montarEstadoMensalServidor({
  servidor,
  year,
  month,
  eventos = [],
  ferias = [],
  atestados = [],
  faltas = [],
  ocorrenciasManuais = [],
  includePontoFacultativo = false,
  faltaNaRubrica = true
}) {
  const feriasNormalizadas = normalizeFeriasInput(ferias);
  const atestadosNormalizados = normalizeAtestadosInput(atestados);
  const faltasNormalizadas = normalizeFaltasInput(faltas);
  const eventosNormalizados = normalizeEventosInput(eventos);
  const manuaisNormalizados = normalizeOcorrenciasManuaisInput(ocorrenciasManuais);

  const monthlyMap = buildMonthlyDayMap({
    year,
    month,
    events: eventosNormalizados,
    vacations: feriasNormalizadas,
    atestados: atestadosNormalizados,
    faltas: faltasNormalizadas,
    manualEntries: manuaisNormalizados,
    includePontoFacultativo,
    faltaNaRubrica,
    priority: [
      'SABADO',
      'DOMINGO',
      'FERIADO',
      'FERIAS',
      'ATESTADO',
      'FALTA',
      'PONTO_FACULTATIVO',
      'MANUAL'
    ]
  });

  return {
    servidor: normalizeServidor(servidor),
    year,
    month,
    lastDay: monthlyMap.lastDay,
    hiddenRowsFrom: monthlyMap.hiddenRowsFrom,
    hiddenRowsTo: monthlyMap.hiddenRowsTo,
    dayMap: monthlyMap.dayMap
  };
}

function montarContextoTemplateFrequencia({
  servidor,
  year,
  month,
  eventos = [],
  ferias = [],
  atestados = [],
  faltas = [],
  ocorrenciasManuais = [],
  includePontoFacultativo = false,
  faltaNaRubrica = true
}) {
  const estadoMensal = montarEstadoMensalServidor({
    servidor,
    year,
    month,
    eventos,
    ferias,
    atestados,
    faltas,
    ocorrenciasManuais,
    includePontoFacultativo,
    faltaNaRubrica
  });

  const cabecalho = buildCabecalhoPlaceholders({
    servidor,
    year,
    month
  });

  const daysContext = buildTemplateDataFromDayMap(
    {
      lastDay: estadoMensal.lastDay,
      dayMap: estadoMensal.dayMap
    },
    {
      keepWeekdayLabel: true,
      includeVisibilityFlags: true,
      fillBlankDaysUpTo31: true
    }
  );

  return {
    ...cabecalho,
    ...daysContext,
    LAST_DAY: estadoMensal.lastDay,
    HIDDEN_ROWS_FROM: estadoMensal.hiddenRowsFrom <= 31 ? estadoMensal.hiddenRowsFrom : '',
    HIDDEN_ROWS_TO: estadoMensal.hiddenRowsTo <= 31 ? estadoMensal.hiddenRowsTo : '',
    MONTH_IS_COMPLETE_31: estadoMensal.lastDay === 31
  };
}

function montarResumoInstitucionalDia(item) {
  if (!item) return null;

  return {
    dia: item.dia,
    dataISO: item.dataISO,
    weekdayLabel: item.weekdayLabel,
    statusFinal: item.finalStatus,
    rubrica: item.rubrica,
    ocorrencia1: item.ocorrencia1,
    ocorrencia2: item.ocorrencia2,
    observacoes: item.observacoes
  };
}

function montarDiagnosticoMensal(estadoMensal) {
  const linhas = [];
  const dayMap = estadoMensal?.dayMap || {};

  Object.keys(dayMap)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((dia) => {
      const item = dayMap[dia];
      linhas.push(montarResumoInstitucionalDia(item));
    });

  return {
    servidor: estadoMensal?.servidor?.nome || '',
    ano: estadoMensal?.year || '',
    mes: estadoMensal?.month || '',
    ultimoDia: estadoMensal?.lastDay || '',
    linhas
  };
}

function filtrarRegistrosDoMes(registros = [], year, month, dateFieldNames = ['data', 'date', 'dataISO']) {
  const prefix = `${year}-${pad2(month)}-`;

  return asArray(registros).filter((item) => {
    for (const field of dateFieldNames) {
      const iso = dateToISO(item?.[field]);
      if (iso && iso.startsWith(prefix)) return true;
    }

    const inicio = dateToISO(item?.inicio || item?.data_inicio || item?.start || item?.periodo1_inicio);
    const fim = dateToISO(item?.fim || item?.data_fim || item?.end || item?.periodo1_fim);

    if (inicio && fim) {
      const firstOfMonth = `${year}-${pad2(month)}-01`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const lastOfMonth = `${year}-${pad2(month)}-${pad2(lastDay)}`;
      return !(fim < firstOfMonth || inicio > lastOfMonth);
    }

    return false;
  });
}

module.exports = {
  montarEstadoMensalServidor,
  montarContextoTemplateFrequencia,
  montarDiagnosticoMensal,
  filtrarRegistrosDoMes,
  normalizeFeriasInput,
  normalizeAtestadosInput,
  normalizeFaltasInput,
  normalizeEventosInput,
  normalizeOcorrenciasManuaisInput
};
