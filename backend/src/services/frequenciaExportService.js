'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function sanitizeFileName(value, extension) {
  const base = String(value || 'frequencia')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'frequencia';
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : `${base}${ext}`;
}

function firstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function resolveTemplatePath(customPath) {
  const cwd = process.cwd();
  const candidates = [
    customPath,
    process.env.FREQUENCIA_TEMPLATE_PATH,
    path.join(cwd, 'templates', 'modelo_frequencia.docx'),
    path.join(cwd, 'backend', 'templates', 'modelo_frequencia.docx'),
    path.join(cwd, 'src', 'templates', 'modelo_frequencia.docx'),
    path.join(cwd, 'modelo_frequencia.docx')
  ].filter(Boolean);

  const resolved = firstExisting(candidates);
  if (!resolved) {
    throw new Error(
      `Template DOCX de frequência não encontrado. Caminhos verificados: ${candidates.join(' | ')}`
    );
  }
  return resolved;
}

function renderDocxBuffer(templatePath, templateData) {
  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter() {
      return '';
    }
  });

  try {
    doc.render(templateData || {});
  } catch (error) {
    const details = error?.properties?.errors
      ? error.properties.errors.map((e) => e.properties?.explanation || e.name).join(' | ')
      : error?.message;
    throw new Error(`Falha ao preencher o template DOCX da frequência: ${details || 'erro desconhecido'}`);
  }

  return doc.getZip().generate({ type: 'nodebuffer' });
}

async function convertDocxBufferToPdfBuffer(docxBuffer, basename) {
  const soffice = process.env.SOFFICE_BINARY || 'soffice';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ciapi-freq-'));
  const inputDir = ensureDir(path.join(tempRoot, 'input'));
  const outputDir = ensureDir(path.join(tempRoot, 'output'));
  const docxName = sanitizeFileName(basename, '.docx');
  const pdfName = sanitizeFileName(basename, '.pdf');
  const inputPath = path.join(inputDir, docxName);
  const outputPath = path.join(outputDir, pdfName);

  fs.writeFileSync(inputPath, docxBuffer);

  try {
    await execFileAsync(soffice, [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      inputPath
    ], { timeout: 120000 });
  } catch (error) {
    const stderr = String(error?.stderr || '').trim();
    const stdout = String(error?.stdout || '').trim();
    throw new Error(
      `Não foi possível converter a frequência para PDF. Verifique se o LibreOffice/soffice está disponível no servidor. ${stderr || stdout || error.message}`.trim()
    );
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('A conversão para PDF foi executada, mas o arquivo PDF não foi gerado.');
  }

  return fs.readFileSync(outputPath);
}

async function exportarFrequencia({
  templateData,
  formato = 'docx',
  templatePath,
  outputFileName,
  removerLinhasExcedentes = true
}) {
  if (!templateData || typeof templateData !== 'object') {
    throw new Error('templateData é obrigatório.');
  }

  const resolvedTemplatePath = resolveTemplatePath(templatePath);
  const resolvedFormat = String(formato || 'docx').trim().toLowerCase();
  if (!['docx', 'pdf'].includes(resolvedFormat)) {
    throw new Error(`Formato inválido para exportação da frequência: ${formato}`);
  }

  // manter compatibilidade com payload existente, mesmo que o corte real de linhas
  // seja feito no builder/template via placeholders em branco.
  void removerLinhasExcedentes;

  const baseName = sanitizeFileName(outputFileName || 'frequencia', resolvedFormat === 'pdf' ? '.pdf' : '.docx')
    .replace(/\.(docx|pdf)$/i, '');

  const docxBuffer = renderDocxBuffer(resolvedTemplatePath, templateData);

  if (resolvedFormat === 'docx') {
    return {
      ok: true,
      filename: sanitizeFileName(baseName, '.docx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBuffer
    };
  }

  const pdfBuffer = await convertDocxBufferToPdfBuffer(docxBuffer, baseName);
  return {
    ok: true,
    filename: sanitizeFileName(baseName, '.pdf'),
    mimeType: 'application/pdf',
    buffer: pdfBuffer
  };
}

module.exports = {
  exportarFrequencia
};
