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
const {
  buildFrequenciaTemplateData,
  sanitizeTemplatePayload,
} = require('../utils/frequenciaTemplateBuilder');
const { createZipFromEntries } = require('../utils/zipBufferHelper');

const execFileAsync = promisify(execFile);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SMALL_BATCH_SINGLE_FILE_LIMIT = 1;

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

function slugify(value) {
  return safeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'servidor';
}

function normalizeExportFormat(formato) {
  const format = String(formato || 'docx').toLowerCase();
  if (!['docx', 'pdf'].includes(format)) {
    throw new Error('Formato inválido. Use "docx" ou "pdf"');
  }
  return format;
}

function normalizeExportMode(modoExportacao, escopoExportacao, payload) {
  const explicitScope = safeText(escopoExportacao);
  const explicitMode = safeText(modoExportacao);

  if (explicitMode === 'lote') return 'lote';
  if (explicitMode === 'individual') return 'individual';
  if (explicitScope && explicitScope !== 'servidor_selecionado') return 'lote';
  if (payload?.usarFiltrosAtuais) return 'lote';
  if (Array.isArray(payload?.servidoresCpf) && payload.servidoresCpf.length) return 'lote';
  if (Array.isArray(payload?.servidoresIds) && payload.servidoresIds.length) return 'lote';
  return 'individual';
}

function normalizeScope(scope) {
  const value = safeText(scope) || 'servidor_selecionado';
  const allowed = new Set([
    'servidor_selecionado',
    'todos_ativos',
    'todos_inativos',
    'todos',
    'categoria',
    'setor',
    'filtros_atuais',
  ]);

  if (!allowed.has(value)) {
    throw new Error(`Escopo de exportação inválido: ${value}`);
  }

  return value;
}

function getFriendlyFileName(servidor, ano, mes, ext) {
  const nome = slugify(servidor?.nome || 'servidor');
  const yyyy = String(ano).padStart(4, '0');
  const mm = String(mes).padStart(2, '0');
  return `frequencia_${nome}_${yyyy}_${mm}.${ext}`;
}

function buildBatchBaseName({ ano, mes, status, categoria, setor, escopoExportacao }) {
  const yyyy = String(ano).padStart(4, '0');
  const mm = String(mes).padStart(2, '0');
  const statusSlug = slugify(status);
  const categoriaSlug = slugify(categoria);
  const setorSlug = slugify(setor);

  switch (escopoExportacao) {
    case 'todos_ativos':
      return `frequencias_ativos_${yyyy}_${mm}`;
    case 'todos_inativos':
      return `frequencias_inativos_${yyyy}_${mm}`;
    case 'categoria':
      return `frequencias_categoria_${categoriaSlug || 'geral'}_${yyyy}_${mm}`;
    case 'setor':
      return `frequencias_setor_${setorSlug || 'geral'}_${yyyy}_${mm}`;
    case 'filtros_atuais':
      return `frequencias_filtradas_${statusSlug || 'todos'}_${yyyy}_${mm}`;
    case 'todos':
    default:
      return `frequencias_todos_${yyyy}_${mm}`;
  }
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

function deepSanitize(value) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    return safeText(value);
  }

  if (Array.isArray(value)) {
    return value.map(deepSanitize);
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = deepSanitize(item);
    }
    return output;
  }

  return value;
}

function forceHourFieldsBlank(templateData = {}) {
  const out = { ...templateData };

  for (let day = 1; day <= 31; day += 1) {
    out[`E1_${day}`] = '';
    out[`SA1_${day}`] = '';
    out[`E2_${day}`] = '';
    out[`SA2_${day}`] = '';
    out[`H1E_${day}`] = '';
    out[`H1S_${day}`] = '';
    out[`H2E_${day}`] = '';
    out[`H2S_${day}`] = '';
  }

  return out;
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
      nullGetter() {
        return '';
      },
    });

    const finalData = forceHourFieldsBlank(
      sanitizeTemplatePayload(deepSanitize(templateData))
    );

    doc.render(finalData);

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

function extractRowsFromListar(payload) {
  const wrapper = payload?.data;
  if (Array.isArray(wrapper)) return wrapper;
  if (Array.isArray(wrapper?.data)) return wrapper.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function extractConsolidatedItem(result, { servidorId, servidorCpf }) {
  const rows = extractRowsFromListar(result);
  const cpf = onlyDigits(servidorCpf);

  if (cpf) {
    const byCpf = rows.find((row) => onlyDigits(row?.servidor?.cpf) === cpf);
    if (byCpf) return byCpf;
  }

  if (servidorId !== undefined && servidorId !== null && servidorId !== '') {
    const byId = rows.find(
      (row) =>
        String(
          row?.servidor?.id ??
            row?.servidor?.servidor ??
            row?.servidor?.uuid ??
            row?.servidor?.servidor_id ??
            ''
        ) === String(servidorId)
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
  const fromBuilder = buildFrequenciaTemplateData(
    item?.servidor || {},
    item?.ano,
    item?.mes,
    item?.dayItems || []
  );

  const rawTemplateData =
    item?.templateData && typeof item.templateData === 'object'
      ? deepSanitize(item.templateData)
      : {};

  const merged = {
    ...rawTemplateData,
    ...fromBuilder,
  };

  return forceHourFieldsBlank(sanitizeTemplatePayload(deepSanitize(merged)));
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
      ['--headless', '--convert-to', 'pdf', '--outdir', tempDir, docxPath],
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
      // ignora
    }
  }
}

function buildSelectionContext(payload = {}) {
  const status = safeText(payload.status);
  const categoria = safeText(payload.categoria);
  const setor = safeText(payload.setor);
  const explicitCpfList = Array.isArray(payload.servidoresCpf)
    ? payload.servidoresCpf.map(onlyDigits).filter(Boolean)
    : [];
  const explicitIdList = Array.isArray(payload.servidoresIds)
    ? payload.servidoresIds.map((item) => String(item)).filter(Boolean)
    : [];

  const explicitCpfSet = new Set(explicitCpfList);
  const explicitIdSet = new Set(explicitIdList);

  return {
    status,
    categoria,
    setor,
    explicitCpfSet,
    explicitIdSet,
    usarFiltrosAtuais: Boolean(payload.usarFiltrosAtuais),
  };
}

function applyScopeToFilters(scope, selectionContext) {
  const filters = {
    status: selectionContext.status || undefined,
    categoria: selectionContext.categoria || undefined,
    setor: selectionContext.setor || undefined,
  };

  if (scope === 'todos_ativos') {
    filters.status = 'ATIVO';
  } else if (scope === 'todos_inativos') {
    filters.status = 'INATIVO';
  } else if (scope === 'todos') {
    filters.status = undefined;
    filters.categoria = undefined;
    filters.setor = undefined;
  } else if (scope === 'categoria') {
    if (!filters.categoria) {
      throw new Error('Informe uma categoria para exportação em lote por categoria.');
    }
  } else if (scope === 'setor') {
    if (!filters.setor) {
      throw new Error('Informe um setor para exportação em lote por setor.');
    }
  }

  return filters;
}

function filterRowsByExplicitSelection(rows, selectionContext) {
  const hasExplicitCpf = selectionContext.explicitCpfSet.size > 0;
  const hasExplicitId = selectionContext.explicitIdSet.size > 0;

  if (!hasExplicitCpf && !hasExplicitId) {
    return rows;
  }

  return rows.filter((row) => {
    const cpf = onlyDigits(row?.servidor?.cpf);
    const id = String(
      row?.servidor?.id ??
        row?.servidor?.servidor ??
        row?.servidor?.uuid ??
        row?.servidor?.servidor_id ??
        ''
    );

    return (
      (hasExplicitCpf && cpf && selectionContext.explicitCpfSet.has(cpf)) ||
      (hasExplicitId && id && selectionContext.explicitIdSet.has(id))
    );
  });
}

async function getBatchConsolidatedItems({ ano, mes, escopoExportacao, payload }) {
  const selectionContext = buildSelectionContext(payload);
  const filters = applyScopeToFilters(escopoExportacao, selectionContext);

  const result = await listarFrequenciaMensal({
    ano,
    mes,
    categoria: filters.categoria,
    setor: filters.setor,
    status: filters.status,
  });

  const rows = filterRowsByExplicitSelection(
    extractRowsFromListar(result),
    selectionContext
  );

  if (!rows.length) {
    throw new Error('Nenhum servidor encontrado para a exportação em lote com os filtros informados.');
  }

  return {
    rows,
    effectiveFilters: filters,
  };
}

async function buildRenderedDocumentItem({ item, ano, mes, formato, templateBinary }) {
  const templateData = buildTemplateDataFromConsolidated(item);
  const docxBuffer = buildDocxBufferFromTemplate(templateBinary, templateData);
  const baseFileName = getFriendlyFileName(item?.servidor, ano, mes, 'docx').replace(/\.docx$/i, '');

  if (formato === 'docx') {
    return {
      fileName: `${baseFileName}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBuffer,
      servidor: item?.servidor || {},
    };
  }

  const pdfBuffer = await convertDocxBufferToPdfBuffer(docxBuffer, baseFileName);

  return {
    fileName: `${baseFileName}.pdf`,
    mimeType: 'application/pdf',
    buffer: pdfBuffer,
    servidor: item?.servidor || {},
  };
}

async function exportarFrequenciaIndividual(payload) {
  const year = Number(payload.ano);
  const month = Number(payload.mes);
  const format = normalizeExportFormat(payload.formato);

  if (!year || !month) {
    throw new Error('Os campos ano e mes são obrigatórios');
  }

  if (!payload.servidorId && !payload.servidorCpf) {
    throw new Error('Informe servidorId ou servidorCpf para exportar a frequência individual');
  }

  const templatePath = await resolveTemplatePath();
  const templateBinary = await fsp.readFile(templatePath);

  const consolidated = await getConsolidatedFrequenciaByServidor({
    ano: year,
    mes: month,
    servidorId: payload.servidorId,
    servidorCpf: payload.servidorCpf,
    categoria: payload.categoria,
    setor: payload.setor,
    status: payload.status,
  });

  const rendered = await buildRenderedDocumentItem({
    item: consolidated,
    ano: year,
    mes: month,
    formato: format,
    templateBinary,
  });

  return {
    ok: true,
    modoExportacao: 'individual',
    formato: format,
    fileName: rendered.fileName,
    mimeType: rendered.mimeType,
    buffer: rendered.buffer,
    servidor: consolidated.servidor,
    ano: year,
    mes: month,
    totalArquivos: 1,
    templatePath,
  };
}

async function exportarFrequenciaLote(payload) {
  const year = Number(payload.ano);
  const month = Number(payload.mes);
  const format = normalizeExportFormat(payload.formato);
  const escopoExportacao = normalizeScope(payload.escopoExportacao || 'filtros_atuais');

  if (!year || !month) {
    throw new Error('Os campos ano e mes são obrigatórios');
  }

  const templatePath = await resolveTemplatePath();
  const templateBinary = await fsp.readFile(templatePath);

  const { rows, effectiveFilters } = await getBatchConsolidatedItems({
    ano: year,
    mes: month,
    escopoExportacao,
    payload,
  });

  if (rows.length <= SMALL_BATCH_SINGLE_FILE_LIMIT) {
    const renderedSingle = await buildRenderedDocumentItem({
      item: rows[0],
      ano: year,
      mes: month,
      formato: format,
      templateBinary,
    });

    return {
      ok: true,
      modoExportacao: 'lote',
      estrategia: 'arquivo_unico',
      escopoExportacao,
      formato: format,
      fileName: renderedSingle.fileName,
      mimeType: renderedSingle.mimeType,
      buffer: renderedSingle.buffer,
      ano: year,
      mes: month,
      totalArquivos: 1,
      totalServidores: 1,
      templatePath,
      filtrosAplicados: effectiveFilters,
    };
  }

  const renderedEntries = [];

  for (const row of rows) {
    const rendered = await buildRenderedDocumentItem({
      item: row,
      ano: year,
      mes: month,
      formato: format,
      templateBinary,
    });

    renderedEntries.push({
      name: rendered.fileName,
      data: rendered.buffer,
    });
  }

  const zipBuffer = createZipFromEntries(renderedEntries);
  const batchBaseName = buildBatchBaseName({
    ano: year,
    mes: month,
    status: effectiveFilters.status,
    categoria: effectiveFilters.categoria,
    setor: effectiveFilters.setor,
    escopoExportacao,
  });

  return {
    ok: true,
    modoExportacao: 'lote',
    estrategia: 'zip',
    escopoExportacao,
    formato: format,
    fileName: `${batchBaseName}.zip`,
    mimeType: 'application/zip',
    buffer: zipBuffer,
    ano: year,
    mes: month,
    totalArquivos: renderedEntries.length,
    totalServidores: rows.length,
    templatePath,
    filtrosAplicados: effectiveFilters,
  };
}

async function exportarFrequencia(payload) {
  const mode = normalizeExportMode(
    payload?.modoExportacao,
    payload?.escopoExportacao,
    payload || {}
  );

  if (mode === 'lote') {
    return exportarFrequenciaLote(payload || {});
  }

  return exportarFrequenciaIndividual(payload || {});
}

module.exports = {
  exportarFrequencia,
  exportarFrequenciaIndividual,
  exportarFrequenciaLote,
};
