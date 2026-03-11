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
const TEMPLATE_DIR = path.join(process.cwd(), 'backend', 'templates');
const TEMPLATE_PATH = path.join(TEMPLATE_DIR, 'modelo_frequencia.docx');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[frequenciaExportService] SUPABASE_URL ou SUPABASE_SERVICE_KEY não definidos.');
}

const supabase = createClient(SUPABASE_URL || 'https://invalid.local', SUPABASE_SERVICE_KEY || 'invalid');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function pad2(n) {
  return String(n).padStart(2, '0');
}

function buildMonthRange(ano, mes) {
  const start = `${ano}-${pad2(mes)}-01`;
  const lastDay = new Date(Number(ano), Number(mes), 0).getDate();
  const end = `${ano}-${pad2(mes)}-${pad2(lastDay)}`;
  return { start, end, lastDay };
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;

  const y = dt.getFullYear();
  const m = pad2(dt.getMonth() + 1);
  const d = pad2(dt.getDate());
  return `${y}-${m}-${d}`;
}

function formatDateBR(value) {
  const iso = normalizeDate(value);
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function getServidorDisplayName(servidor) {
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

function getServidorSetor(servidor) {
  return (
    normalizeText(servidor?.setor) ||
    normalizeText(servidor?.lotacao) ||
    normalizeText(servidor?.lotacao_interna) ||
    ''
  );
}

function getServidorCategoria(servidor) {
  return normalizeText(servidor?.categoria) || '';
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

function getTurnoLabel(turno) {
  const v = normalizeText(turno).toUpperCase();
  if (!v) return '';
  if (v === 'MANHA') return 'MANHÃ';
  if (v === 'TARDE') return 'TARDE';
  if (v === 'INTEGRAL') return 'INTEGRAL';
  return v;
}

function buildWeekendLabel(date) {
  const weekday = date.getDay();
  if (weekday === 6) return 'SÁBADO';
  if (weekday === 0) return 'DOMINGO';
  return '';
}

async function getServidorByIdOrCpf(servidorId) {
  const idRaw = normalizeText(servidorId);
  const cpfDigits = onlyDigits(idRaw);

  let query = supabase.from('servidores').select('*').limit(1);

  if (cpfDigits && cpfDigits.length >= 11) {
    const { data, error } = await query.eq('cpf', cpfDigits).maybeSingle();
    if (!error && data) return data;
  }

  {
    const { data, error } = await supabase
      .from('servidores')
      .select('*')
      .eq('servidor', idRaw)
      .maybeSingle();

    if (!error && data) return data;
  }

  {
    const { data, error } = await supabase
      .from('servidores')
      .select('*')
      .eq('id', idRaw)
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
    console.warn('[frequenciaExportService] eventos:', error.message);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function getOcorrenciasDoMes(ano, mes, servidorId, servidorCpf) {
  const { start, end } = buildMonthRange(ano, mes);

  let data = [];
  let error = null;

  if (servidorId) {
    const res = await supabase
      .from('frequencia')
      .select('*')
      .gte('data', start)
      .lte('data', end)
      .eq('servidor_id', servidorId)
      .order('data', { ascending: true });

    data = res.data;
    error = res.error;
  }

  if ((!data || data.length === 0) && servidorCpf) {
    const res = await supabase
      .from('frequencia')
      .select('*')
      .gte('data', start)
      .lte('data', end)
      .eq('servidor_cpf', servidorCpf)
      .order('data', { ascending: true });

    data = res.data;
    error = res.error;
  }

  if (error) {
    console.warn('[frequenciaExportService] frequencia:', error.message);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function getFeriasDoServidor(servidorCpf, ano, mes) {
  const { data, error } = await supabase
    .from('ferias')
    .select('*')
    .eq('servidor_cpf', servidorCpf);

  if (error) {
    console.warn('[frequenciaExportService] ferias:', error.message);
    return [];
  }

  const { start, end } = buildMonthRange(ano, mes);

  return (Array.isArray(data) ? data : []).flatMap((item) => {
    const periodos = [
      {
        inicio: normalizeDate(item.periodo1_inicio),
        fim: normalizeDate(item.periodo1_fim),
        periodo: 1,
      },
      {
        inicio: normalizeDate(item.periodo2_inicio),
        fim: normalizeDate(item.periodo2_fim),
        periodo: 2,
      },
      {
        inicio: normalizeDate(item.periodo3_inicio),
        fim: normalizeDate(item.periodo3_fim),
        periodo: 3,
      },
    ];

    return periodos.filter((p) => p.inicio && p.fim && !(p.fim < start || p.inicio > end));
  });
}

function collectBirthdays(servidor, ano, mes) {
  const raw = normalizeText(servidor?.data_nascimento || servidor?.dataNascimento);
  if (!raw) return [];

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return [];

  if (dt.getMonth() + 1 !== Number(mes)) return [];

  const day = dt.getDate();
  const dateIso = `${ano}-${pad2(mes)}-${pad2(day)}`;

  return [{
    data: dateIso,
    titulo: `ANIVERSÁRIO DE ${getServidorDisplayName(servidor).toUpperCase()}`,
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
      turno: getTurnoLabel(item?.turno),
      descricao: normalizeText(item?.descricao || item?.observacao),
    });
  }

  return map;
}

function buildFeriasSet(feriasList) {
  const set = new Map();

  for (const periodo of feriasList) {
    const inicio = normalizeDate(periodo.inicio);
    const fim = normalizeDate(periodo.fim);
    if (!inicio || !fim) continue;

    let cursor = new Date(`${inicio}T12:00:00`);
    const end = new Date(`${fim}T12:00:00`);

    while (cursor <= end) {
      const iso = normalizeDate(cursor.toISOString());
      if (!set.has(iso)) set.set(iso, []);
      set.get(iso).push({
        tipo: 'FERIAS',
        titulo: `FÉRIAS ${periodo.periodo ? `- ${periodo.periodo}º PERÍODO` : ''}`.trim(),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return set;
}

function buildBirthdaysMap(list) {
  const map = new Map();
  for (const item of list) {
    const iso = normalizeDate(item.data);
    if (!iso) continue;
    if (!map.has(iso)) map.set(iso, []);
    map.get(iso).push(item);
  }
  return map;
}

function buildDayDescription({
  date,
  eventosMap,
  ocorrenciasMap,
  feriasMap,
  birthdaysMap,
}) {
  const iso = normalizeDate(date.toISOString());
  const labels = [];

  const weekend = buildWeekendLabel(date);
  if (weekend) labels.push(weekend);

  const eventos = eventosMap.get(iso) || [];
  const ferias = feriasMap.get(iso) || [];
  const ocorrencias = ocorrenciasMap.get(iso) || [];
  const birthdays = birthdaysMap.get(iso) || [];

  for (const item of eventos) {
    if (item.tipo === 'FERIADO') labels.push('FERIADO');
    else if (item.tipo === 'PONTO') labels.push('PONTO FACULTATIVO');
    else labels.push(item.titulo.toUpperCase());
  }

  for (const item of ferias) {
    labels.push(item.titulo.toUpperCase());
  }

  for (const item of birthdays) {
    labels.push(item.titulo.toUpperCase());
  }

  for (const item of ocorrencias) {
    const tipo = normalizeText(item.tipo).toUpperCase();

    if (tipo.includes('ATEST')) {
      labels.push(item.turno ? `ATESTADO (${item.turno})` : 'ATESTADO');
    } else if (tipo.includes('FALTA')) {
      labels.push(item.turno ? `FALTA (${item.turno})` : 'FALTA');
    } else if (tipo) {
      labels.push(item.turno ? `${tipo} (${item.turno})` : tipo);
    }

    if (item.descricao) {
      labels.push(item.descricao.toUpperCase());
    }
  }

  const unique = [];
  const seen = new Set();

  for (const item of labels) {
    const key = normalizeText(item).toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }

  return unique.join(' • ');
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

    const pdfPath = inputDocxPath.replace(/\.docx$/i, '.pdf');
    if (fs.existsSync(pdfPath)) {
      return pdfPath;
    }

    const pdfCandidate = path.join(
      outputDir,
      path.basename(inputDocxPath).replace(/\.docx$/i, '.pdf'),
    );

    if (fs.existsSync(pdfCandidate)) {
      return pdfCandidate;
    }

    throw new Error('PDF não foi gerado pelo LibreOffice.');
  } catch (error) {
    throw new Error(
      `Conversão para PDF indisponível neste ambiente. Instale LibreOffice/soffice no servidor. Detalhe: ${error.message}`
    );
  }
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

  if (!fs.existsSync(TEMPLATE_PATH) && formato === 'docx') {
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
    servidorCpf ? getFeriasDoServidor(servidorCpf, ano, mes) : [],
    Promise.resolve(collectBirthdays(servidor, ano, mes)),
  ]);

  const { lastDay } = buildMonthRange(ano, mes);
  const eventosMap = mapEventosPorDia(eventos, incluirPonto);
  const ocorrenciasMap = mapOcorrenciasPorDia(ocorrencias);
  const feriasMap = buildFeriasSet(ferias);
  const birthdaysMap = buildBirthdaysMap(birthdays);

  const linhas = [];
  for (let dia = 1; dia <= lastDay; dia += 1) {
    const date = new Date(ano, mes - 1, dia, 12, 0, 0);
    const iso = `${ano}-${pad2(mes)}-${pad2(dia)}`;

    linhas.push({
      dia,
      dataIso: iso,
      descricao: buildDayDescription({
        date,
        eventosMap,
        ocorrenciasMap,
        feriasMap,
        birthdaysMap,
      }),
    });
  }

  const payload = {
    servidor: {
      nome: getServidorDisplayName(servidor).toUpperCase(),
      matricula: getServidorMatricula(servidor),
      cpf: servidorCpf,
      cargo: getServidorCargo(servidor).toUpperCase(),
      setor: getServidorSetor(servidor).toUpperCase(),
      categoria: getServidorCategoria(servidor).toUpperCase(),
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
      incluirPonto,
    },
    linhas,
    ocorrencias,
    eventos,
    ferias,
    birthdays,
  };

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
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
