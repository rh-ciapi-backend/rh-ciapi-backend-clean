const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const { execFile } = require('child_process');

const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { createClient } = require('@supabase/supabase-js');

const { listarFrequenciaMensal } = require('./frequenciaService');
const { buildFrequenciaTemplateData } = require('../utils/frequenciaTemplateBuilder');

const execFileAsync = promisify(execFile);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function slugify(value) {
  return safeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'servidor';
}

function getFriendlyFileName(servidor, ano, mes, ext) {
  const nome = slugify(servidor?.nome || 'servidor');
  const yyyy = String(ano).padStart(4, '0');
  const mm = String(mes).padStart(2, '0');
  return `frequencia_${nome}_${yyyy}_${mm}.${ext}`;
}

function resolveTemplateCandidates() {
  const cwd = process.cwd();

  return [
    process.env.FREQUENCIA_TEMPLATE_PATH,
    path.join(cwd, 'templates', 'modelo_frequencia.docx'),
    path.join(cwd, 'src', 'templates', 'modelo_frequencia.docx'),
    path.join(__dirname, '../../templates/modelo_frequencia.docx'),
    path.join(__dirname, '../../../templates/modelo_frequencia.docx'),
  ].filter(Boolean);
}

async function resolveTemplatePath() {
  const candidates = resolveTemplateCandidates();

  for (const candidate of candidates) {
    try {
      await fsp.access(candidate, fs.constants.R_OK);
      return candidate;
    } catch (_) {
      // tenta o próximo
    }
  }

  throw new Error(
    `Template oficial da frequência não encontrado. Verifique FREQUENCIA_TEMPLATE_PATH ou coloque o arquivo modelo_frequencia.docx em uma destas rotas: ${candidates.join(' | ')}`
  );
}

function buildDocxBufferFromTemplate(templateBinary, templateData) {
  try {
    const zip = new PizZip(templateBinary);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: {
        start: '{{',
        end: '}}',
      },
    });

    doc.render(templateData);

    return doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
  } catch (error) {
    const explanation =
      error?.properties?.errors
        ?.map((e) => e?.properties?.explanation)
        .filter(Boolean)
        .join(' | ') ||
      error?.message ||
      'Erro desconhecido ao preencher template DOCX';

    throw new Error(`Falha ao preencher o template DOCX: ${explanation}`);
  }
}

async function findServidorBase({ servidorId, servidorCpf }) {
  if (servidorCpf) {
    const cpf = onlyDigits(servidorCpf);
    const { data, error } = await supabase
      .from('servidores')
      .select('*')
      .eq('cpf', cpf)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Erro ao localizar servidor por CPF: ${error.message}`);
    }

    if (data) return data;
  }

  if (servidorId) {
    for (const field of ['servidor', 'id', 'uuid', 'servidor_id']) {
      const { data, error } = await supabase
        .from('servidores')
        .select('*')
        .eq(field, servidorId)
        .limit(1)
        .maybeSingle();

      if (!error && data) return data;
    }
  }

  return null;
}

function extractConsolidatedItem(result, { servidorId, servidorCpf }) {
  const wrapper = result?.data;
  const rows = Array.isArray(wrapper)
    ? wrapper
    : Array.isArray(wrapper?.data)
    ? wrapper.data
    : [];

  const cpf = onlyDigits(servidorCpf);

  if (cpf) {
    const byCpf = rows.find((row) => onlyDigits(row?.servidor?.cpf) === cpf);
    if (byCpf) return byCpf;
  }

  if (servidorId !== undefined && servidorId !== null && servidorId !== '') {
    const byId = rows.find(
      (row) => String(row?.servidor?.id ?? '') === String(servidorId)
    );
    if (byId) return byId;
  }

  return rows[0] || null;
}

async function getConsolidatedFrequenciaByServidor({
  ano,
  mes,
  servidorId,
  servidorCpf,
  categoria,
  setor,
  status,
}) {
  let cpfToUse = servidorCpf ? onlyDigits(servidorCpf) : '';

  if (!cpfToUse && servidorId) {
    const servidorBase = await findServidorBase({ servidorId, servidorCpf });
    cpfToUse = onlyDigits(servidorBase?.cpf);
  }

  const result = await listarFrequenciaMensal({
    ano,
    mes,
    cpf: cpfToUse || undefined,
    categoria,
    setor,
    status,
  });

  const item = extractConsolidatedItem(result, {
    servidorId,
    servidorCpf: cpfToUse || servidorCpf,
  });

  if (!item) {
    throw new Error(
      'Não foi possível localizar a frequência consolidada do servidor informado'
    );
  }

  return item;
}

function buildTemplateDataFromConsolidated(item) {
  if (item?.templateData && typeof item.templateData === 'object') {
    return item.templateData;
  }

  return buildFrequenciaTemplateData(
    item?.servidor || {},
    item?.ano,
    item?.mes,
    item?.dayItems || []
  );
}

async function ensureSofficeAvailable() {
  const commands =
    process.platform === 'win32'
      ? ['soffice.exe', 'soffice.com', 'soffice']
      : ['soffice'];

  const errors = [];

  for (const cmd of commands) {
    try {
      await execFileAsync(cmd, ['--version'], { timeout: 15000 });
      return cmd;
    } catch (error) {
      errors.push(`${cmd}: ${error.message}`);
    }
  }

  throw new Error(
    `LibreOffice/soffice não está disponível no ambiente. Instale o LibreOffice ou ajuste o PATH do servidor. Tentativas: ${errors.join(' | ')}`
  );
}

async function convertDocxBufferToPdfBuffer(docxBuffer, outputBaseName) {
  const sofficeCmd = await ensureSofficeAvailable();

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ciapi-freq-'));
  const docxPath = path.join(tempDir, `${outputBaseName}.docx`);
  const pdfPath = path.join(tempDir, `${outputBaseName}.pdf`);

  try {
    await fsp.writeFile(docxPath, docxBuffer);

    await execFileAsync(
      sofficeCmd,
      [
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        tempDir,
        docxPath,
      ],
      {
        timeout: 120000,
        windowsHide: true,
      }
    );

    const pdfBuffer = await fsp.readFile(pdfPath);
    return pdfBuffer;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Arquivo PDF não foi gerado pelo LibreOffice');
    }

    throw new Error(`Falha ao converter DOCX para PDF: ${error.message}`);
  } finally {
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch (_) {
      // ignora erro de limpeza
    }
  }
}

async function exportarFrequencia({
  ano,
  mes,
  servidorId,
  servidorCpf,
  categoria,
  setor,
  status,
  formato,
}) {
  const year = Number(ano);
  const month = Number(mes);
  const format = String(formato || 'docx').toLowerCase();

  if (!year || !month) {
    throw new Error('Os campos ano e mes são obrigatórios');
  }

  if (!servidorId && !servidorCpf) {
    throw new Error(
      'Informe servidorId ou servidorCpf para exportar a frequência individual'
    );
  }

  if (!['docx', 'pdf'].includes(format)) {
    throw new Error('Formato inválido. Use "docx" ou "pdf"');
  }

  const templatePath = await resolveTemplatePath();

  const consolidated = await getConsolidatedFrequenciaByServidor({
    ano: year,
    mes: month,
    servidorId,
    servidorCpf,
    categoria,
    setor,
    status,
  });

  const templateData = buildTemplateDataFromConsolidated(consolidated);
  const templateBinary = await fsp.readFile(templatePath);
  const docxBuffer = buildDocxBufferFromTemplate(templateBinary, templateData);

  const baseFileName = getFriendlyFileName(
    consolidated.servidor,
    year,
    month,
    'docx'
  ).replace(/\.docx$/i, '');

  if (format === 'docx') {
    return {
      ok: true,
      formato: 'docx',
      fileName: `${baseFileName}.docx`,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBuffer,
      servidor: consolidated.servidor,
      ano: year,
      mes: month,
      templatePath,
    };
  }

  const pdfBuffer = await convertDocxBufferToPdfBuffer(docxBuffer, baseFileName);

  return {
    ok: true,
    formato: 'pdf',
    fileName: `${baseFileName}.pdf`,
    mimeType: 'application/pdf',
    buffer: pdfBuffer,
    servidor: consolidated.servidor,
    ano: year,
    mes: month,
    templatePath,
  };
}

module.exports = {
  exportarFrequencia,
};
