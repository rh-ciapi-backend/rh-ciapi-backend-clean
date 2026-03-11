const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const {
  gerarDocxFrequencia,
  gerarCsvFrequencia,
  sanitizeFileName,
} = require('../utils/frequenciaTemplateBuilder');

const execFileAsync = promisify(execFile);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const EXPORT_DIR = process.env.EXPORT_DIR || path.join(os.tmpdir(), 'exports');
const TEMPLATE_PATH = path.join(process.cwd(), 'backend', 'templates', 'modelo_frequencia.docx');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[frequenciaExportService] SUPABASE_URL ou SUPABASE_SERVICE_KEY não definidos.');
}

const supabase = createClient(
  SUPABASE_URL || 'https://invalid.local',
  SUPABASE_SERVICE_KEY || 'invalid'
);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';

  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function formatDateBR(value) {
  const iso = normalizeDate(value);
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function extensoMes(mes) {
  const meses = [
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
  return meses[Number(mes) - 1] || '';
}

function buildMonthRange(ano, mes) {
  const start = `${ano}-${pad2(mes)}-01`;
  const lastDay = new Date(Number(ano), Number(mes), 0).getDate();
  const end = `${ano}-${pad2(mes)}-${pad2(lastDay)}`;
  return { start, end, lastDay };
}

function getWeekdayLabel(date) {
  const wd = date.getDay();
  if (wd === 6) return 'SÁBADO';
  if (wd === 0) return 'DOMINGO';
  return '';
}

function dedupeUpper(values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    const text = normalizeText(value).toUpperCase();
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }

  return result;
}

function getServidorNome(servidor) {
  return (
    normalizeText(servidor?.nome_completo) ||
    normalizeText(servidor?.nomeCompleto) ||
    normalizeText(servidor?.nome) ||
    'SERVIDOR'
  );
}

function getServidorMatricula(servidor) {
  return (
    normalizeText(servidor?.matricula) ||
    normalizeText(servidor?.matrícula) ||
    ''
  );
}

function getServidorCpf(servidor) {
  return normalizeText(servidor?.cpf);
}

function getServidorCargo(servidor) {
  return (
    normalizeText(servidor?.cargo) ||
    normalizeText(servidor?.funcao) ||
    normalizeText(servidor?.função) ||
    ''
  );
}

function getServidorCategoria(servidor) {
  return normalizeText(servidor?.categoria);
}

function getServidorSetor(servidor) {
  return (
    normalizeText(servidor?.setor) ||
    normalizeText(servidor?.lotacao) ||
    normalizeText(servidor?.lotacao_interna) ||
    ''
  );
}

function getChDiaria(servidor) {
  return (
    normalizeText(servidor?.ch_diaria) ||
    normalizeText(servidor?.chDiaria) ||
    normalizeText(servidor?.carga_horaria_diaria) ||
    ''
  );
}

function getChSemanal(servidor) {
  return (
    normalizeText(servidor?.ch_semanal) ||
    normalizeText(servidor?.chSemanal) ||
    normalizeText(servidor?.carga_horaria_semanal) ||
    ''
  );
}

function mapTurno(turno) {
  const t = normalizeText(turno).toUpperCase();
  if (t === 'MANHA') return 'MANHA';
  if (t === 'MANHÃ') return 'MANHA';
  if (t === 'TARDE') return 'TARDE';
  if (t === 'INTEGRAL') return 'INTEGRAL';
  return t || 'INTEGRAL';
}

async function getServidorByIdOrCpf(servidorId) {
  const raw = normalizeText(servidorId);
  const cpfDigits = onlyDigits(raw);

  if (cpfDigits && cpfDigits.length >= 11) {
    const { data, error } = await supabase
      .from('servidores')
      .select('*')
      .eq('cpf', cpfDigits)
      .maybeSingle();

    if (!error && data) return data;
  }

  {
    const { data, error } = await supabase
      .from('servidores')
      .select('*')
      .eq('servidor', raw)
      .maybeSingle();

    if (!error && data) return data;
  }

  {
    const { data, error } = await supabase
      .from('servidores')
      .select('*')
      .eq('id', raw)
      .maybeSingle();

    if (!error && data) return data;
  }

  return null;
}

async function getEventosDoMes(ano, mes) {
  const { start, end } = buildMonthRange(ano, mes);

  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .gte('data', start)
    .lte('data', end)
    .order('data', { ascending: true });

  if (error) {
    console.warn('[frequenciaExportService] erro ao buscar eventos:', error.message);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function getOcorrenciasDoMes(ano, mes, servidorUuid, servidorCpf) {
  const { start, end } = buildMonthRange(ano, mes);

  const results = [];

  if (servidorUuid) {
    const { data, error } = await supabase
      .from('frequencia')
      .select('*')
      .gte('data', start)
      .lte('data', end)
      .eq('servidor_id', servidorUuid)
      .order('data', { ascending: true });

    if (!error && Array.isArray(data)) {
      results.push(...data);
    }
  }

  if (servidorCpf) {
    const { data, error } = await supabase
      .from('frequencia')
      .select('*')
      .gte('data', start)
      .lte('data', end)
      .eq('servidor_cpf', servidorCpf)
      .order('data', { ascending: true });

    if (!error && Array.isArray(data)) {
      results.push(...data);
    }
  }

  const unique = [];
  const seen = new Set();

  for (const item of results) {
    const key = normalizeText(item?.id) || [
      normalizeDate(item?.data),
      normalizeText(item?.tipo),
      normalizeText(item?.turno),
      normalizeText(item?.descricao || item?.observacao),
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  unique.sort((a, b) => normalizeDate(a?.data).localeCompare(normalizeDate(b?.data)));
  return unique;
}

async function getFeriasDoServidor(servidorCpf, ano, mes) {
  if (!servidorCpf) return [];

  const { data, error } = await supabase
    .from('ferias')
    .select('*')
    .eq('servidor_cpf', servidorCpf);

  if (error) {
    console.warn('[frequenciaExportService] erro ao buscar férias:', error.message);
    return [];
  }

  const { start, end } = buildMonthRange(ano, mes);

  const periodos = [];

  for (const item of Array.isArray(data) ? data : []) {
    const candidatos = [
      {
        periodo: 1,
        inicio: normalizeDate(item?.periodo1_inicio),
        fim: normalizeDate(item?.periodo1_fim),
      },
      {
        periodo: 2,
        inicio: normalizeDate(item?.periodo2_inicio),
        fim: normalizeDate(item?.periodo2_fim),
      },
      {
        periodo: 3,
        inicio: normalizeDate(item?.periodo3_inicio),
        fim: normalizeDate(item?.periodo3_fim),
      },
    ];

    for (const c of candidatos) {
      if (!c.inicio || !c.fim) continue;
      if (c.fim < start || c.inicio > end) continue;
      periodos.push(c);
    }
  }

  return periodos;
}

function collectBirthdays(servidor, ano, mes) {
  const raw = normalizeText(servidor?.data_nascimento || servidor?.dataNascimento);
  if (!raw) return [];

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return [];

  if (dt.getMonth() + 1 !== Number(mes)) return [];

  const iso = `${ano}-${pad2(mes)}-${pad2(dt.getDate())}`;
  return [{
    data: iso,
    titulo: `ANIVERSÁRIO`,
  }];
}

function mapEventosPorDia(eventos, incluirPonto) {
  const map = new Map();

  for (const evento of eventos) {
    const iso = normalizeDate(evento?.data);
    if (!iso) continue;

    const tipo = normalizeText(evento?.tipo).toUpperCase();
    if (tipo === 'PONTO' && !incluirPonto) continue;

    if (!map.has(iso)) map.set(iso, []);

    map.get(iso).push({
      tipo,
      titulo: normalizeText(evento?.titulo || evento?.nome || tipo),
      descricao: normalizeText(evento?.descricao),
    });
  }

  return map;
}

function mapOcorrenciasPorDia(ocorrencias) {
  const map = new Map();

  for (const item of ocorrencias) {
    const iso = normalizeDate(item?.data);
    if (!iso) continue;

    if (!map.has(iso)) map.set(iso, []);

    map.get(iso).push({
      id: item?.id,
      tipo: normalizeText(item?.tipo || item?.ocorrencia).toUpperCase(),
      turno: mapTurno(item?.turno),
      descricao: normalizeText(item?.descricao || item?.observacao),
    });
  }

  return map;
}

function buildFeriasMap(periodos) {
  const map = new Map();

  for (const periodo of periodos) {
    let cursor = new Date(`${periodo.inicio}T12:00:00`);
    const end = new Date(`${periodo.fim}T12:00:00`);

    while (cursor <= end) {
      const iso = normalizeDate(cursor.toISOString());
      if (!map.has(iso)) map.set(iso, []);

      map.get(iso).push({
        tipo: 'FERIAS',
        titulo: `FÉRIAS${periodo.periodo ? ` - ${periodo.periodo}º PERÍODO` : ''}`,
      });

      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return map;
}

function buildBirthdaysMap(list) {
  const map = new Map();

  for (const item of list) {
    const iso = normalizeDate(item?.data);
    if (!iso) continue;

    if (!map.has(iso)) map.set(iso, []);
    map.get(iso).push(item);
  }

  return map;
}

function splitDayContent({
  date,
  eventosMap,
  ocorrenciasMap,
  feriasMap,
  birthdaysMap,
}) {
  const iso = normalizeDate(date.toISOString());
  const rubricaParts = [];
  const ocorrenciasManuais = [];

  const weekend = getWeekdayLabel(date);
  if (weekend) {
    rubricaParts.push(weekend);
  }

  const eventos = eventosMap.get(iso) || [];
  const ferias = feriasMap.get(iso) || [];
  const birthdays = birthdaysMap.get(iso) || [];
  const ocorrencias = ocorrenciasMap.get(iso) || [];

  for (const evento of eventos) {
    const tipo = normalizeText(evento?.tipo).toUpperCase();

    if (tipo === 'FERIADO') {
      rubricaParts.push('FERIADO');
    } else if (tipo === 'PONTO') {
      rubricaParts.push('PONTO FACULTATIVO');
    } else {
      rubricaParts.push(normalizeText(evento?.titulo).toUpperCase());
    }
  }

  for (const item of ferias) {
    rubricaParts.push(normalizeText(item?.titulo).toUpperCase());
  }

  for (const item of birthdays) {
    rubricaParts.push(normalizeText(item?.titulo).toUpperCase());
  }

  for (const item of ocorrencias) {
    const tipo = normalizeText(item?.tipo).toUpperCase();
    const turno = mapTurno(item?.turno);
    const descricao = normalizeText(item?.descricao).toUpperCase();

    if (tipo.includes('FALTA') || tipo.includes('ATEST')) {
      ocorrenciasManuais.push({
        tipo,
        turno,
        descricao,
      });
    } else {
      const text = [tipo, descricao].filter(Boolean).join(' - ');
      if (text) rubricaParts.push(text);
    }
  }

  return {
    rubrica: dedupeUpper(rubricaParts).join(' / '),
    ocorrenciasManuais,
  };
}

async function convertDocxToPdf(inputDocxPath, outputDir) {
  ensureDir(outputDir);

  try {
    const result = await execFileAsync('soffice', [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      inputDocxPath,
    ]);

    if (result?.stderr) {
      console.warn('[frequenciaExportService] soffice stderr:', result.stderr);
    }

    const sameDirPdf = inputDocxPath.replace(/\.docx$/i, '.pdf');
    if (fs.existsSync(sameDirPdf)) {
      return sameDirPdf;
    }

    const outPdf = path.join(
      outputDir,
      path.basename(inputDocxPath).replace(/\.docx$/i, '.pdf')
    );

    if (fs.existsSync(outPdf)) {
      return outPdf;
    }

    throw new Error('PDF não foi gerado pelo LibreOffice.');
  } catch (error) {
    throw new Error(
      `Conversão para PDF indisponível neste ambiente. Instale LibreOffice/soffice no servidor. Detalhe: ${error.message}`
    );
  }
}

function buildPayload({ servidor, ano, mes, incluirPonto, eventos, ocorrencias, ferias, birthdays }) {
  const { lastDay } = buildMonthRange(ano, mes);

  const eventosMap = mapEventosPorDia(eventos, incluirPonto);
  const ocorrenciasMap = mapOcorrenciasPorDia(ocorrencias);
  const feriasMap = buildFeriasMap(ferias);
  const birthdaysMap = buildBirthdaysMap(birthdays);

  const linhas = [];

  for (let dia = 1; dia <= lastDay; dia += 1) {
    const date = new Date(ano, mes - 1, dia, 12, 0, 0);
    const iso = `${ano}-${pad2(mes)}-${pad2(dia)}`;
    const parts = splitDayContent({
      date,
      eventosMap,
      ocorrenciasMap,
      feriasMap,
      birthdaysMap,
    });

    linhas.push({
      dia,
      dataIso: iso,
      turnoTexto: formatDateBR(iso),
      rubrica: parts.rubrica,
      ocorrenciasManuais: parts.ocorrenciasManuais,
    });
  }

  return {
    servidor: {
      nome: getServidorNome(servidor).toUpperCase(),
      matricula: getServidorMatricula(servidor),
      cpf: getServidorCpf(servidor),
      cargo: getServidorCargo(servidor).toUpperCase(),
      categoria: getServidorCategoria(servidor).toUpperCase(),
      setor: getServidorSetor(servidor).toUpperCase(),
      chDiaria: getChDiaria(servidor),
      chSemanal: getChSemanal(servidor),
    },
    competencia: {
      ano,
      mes,
      mesExtenso: extensoMes(mes),
      diasNoMes: lastDay,
    },
    filtros: {
      incluirPonto: Boolean(incluirPonto),
    },
    linhas,
    eventos,
    ocorrencias,
    ferias,
    birthdays,
  };
}

async function exportarFrequencia({ formato, body }) {
  const servidorId = normalizeText(body?.servidorId);
  const mes = Number(body?.mes);
  const ano = Number(body?.ano);
  const incluirPonto = Boolean(body?.incluirPonto);

  if (!servidorId) {
    return {
      kind: 'json',
      statusCode: 400,
      payload: { ok: false, error: 'servidorId é obrigatório.' },
    };
  }

  if (!mes || mes < 1 || mes > 12) {
    return {
      kind: 'json',
      statusCode: 400,
      payload: { ok: false, error: 'mes inválido.' },
    };
  }

  if (!ano || ano < 2000) {
    return {
      kind: 'json',
      statusCode: 400,
      payload: { ok: false, error: 'ano inválido.' },
    };
  }

  if ((formato === 'docx' || formato === 'pdf') && !fs.existsSync(TEMPLATE_PATH)) {
    return {
      kind: 'json',
      statusCode: 500,
      payload: {
        ok: false,
        error: 'Modelo de frequência não encontrado.',
        details: `Esperado em: ${TEMPLATE_PATH}`,
      },
    };
  }

  const servidor = await getServidorByIdOrCpf(servidorId);

  if (!servidor) {
    return {
      kind: 'json',
      statusCode: 404,
      payload: { ok: false, error: 'Servidor não encontrado.' },
    };
  }

  const servidorCpf = getServidorCpf(servidor);
  const servidorUuid = normalizeText(servidor?.servidor || servidor?.id);

  const [eventos, ocorrencias, ferias, birthdays] = await Promise.all([
    getEventosDoMes(ano, mes),
    getOcorrenciasDoMes(ano, mes, servidorUuid, servidorCpf),
    getFeriasDoServidor(servidorCpf, ano, mes),
    Promise.resolve(collectBirthdays(servidor, ano, mes)),
  ]);

  const payload = buildPayload({
    servidor,
    ano,
    mes,
    incluirPonto,
    eventos,
    ocorrencias,
    ferias,
    birthdays,
  });

  const exportSubDir = path.join(EXPORT_DIR, 'frequencia');
  ensureDir(exportSubDir);

  const safeName = sanitizeFileName(payload.servidor.nome || 'SERVIDOR');
  const baseFileName = `frequencia_${ano}_${pad2(mes)}_${safeName}`;

  if (formato === 'csv') {
    const csvPath = path.join(exportSubDir, `${baseFileName}.csv`);
    await gerarCsvFrequencia({
      outputPath: csvPath,
      payload,
    });

    return {
      kind: 'download',
      filePath: csvPath,
      fileName: `${baseFileName}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  const docxPath = path.join(exportSubDir, `${baseFileName}.docx`);
  await gerarDocxFrequencia({
    templatePath: TEMPLATE_PATH,
    outputPath: docxPath,
    payload,
  });

  if (formato === 'docx') {
    return {
      kind: 'download',
      filePath: docxPath,
      fileName: `${baseFileName}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  if (formato === 'pdf') {
    const pdfPath = await convertDocxToPdf(docxPath, exportSubDir);
    return {
      kind: 'download',
      filePath: pdfPath,
      fileName: `${baseFileName}.pdf`,
      contentType: 'application/pdf',
    };
  }

  return {
    kind: 'json',
    statusCode: 400,
    payload: { ok: false, error: 'Formato não suportado.' },
  };
}

module.exports = {
  exportarFrequencia,
};
