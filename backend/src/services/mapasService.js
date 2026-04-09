const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const archiver = require('archiver');
const { getMapaPreview } = require('./mapasService');
const { buildMapaTemplatePages } = require('../utils/mapaTemplateBuilder');
const { renderDocxFromTemplate, saveBuffer, ensureDir } = require('../utils/mapaDocxHelper');

const TEMPLATE_SIMPLES = path.resolve(process.cwd(), 'templates', 'modelo_mapa.docx');

function buildBaseName(filters) {
  return `mapa_${filters.ano}_${String(filters.mes).padStart(2, '0')}`;
}

async function exportMapaDocx(filters) {
  const preview = await getMapaPreview(filters);
  if (!fs.existsSync(TEMPLATE_SIMPLES)) {
    throw new Error('Template modelo_mapa.docx não encontrado em templates/.');
  }

  const tempDir = path.join(os.tmpdir(), `mapa_export_${Date.now()}`);
  ensureDir(tempDir);

  const pages = buildMapaTemplatePages(preview);
  const firstPage = pages[0] || {};
  const fileName = `${buildBaseName(filters)}.docx`;
  const filePath = path.join(tempDir, fileName);

  const buffer = renderDocxFromTemplate(TEMPLATE_SIMPLES, firstPage);
  saveBuffer(filePath, buffer);

  return { filePath, fileName, preview };
}

async function convertDocxToPdf(docxPath) {
  const outDir = path.dirname(docxPath);
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, docxPath], { stdio: 'ignore' });
  } catch (error) {
    throw new Error('Conversão para PDF indisponível: LibreOffice/soffice não encontrado no servidor.');
  }
  const pdfPath = docxPath.replace(/\.docx$/i, '.pdf');
  if (!fs.existsSync(pdfPath)) {
    throw new Error('Falha ao converter DOCX para PDF.');
  }
  return pdfPath;
}

async function exportMapaPdf(filters) {
  const { filePath, preview } = await exportMapaDocx(filters);
  const pdfPath = await convertDocxToPdf(filePath);
  return {
    filePath: pdfPath,
    fileName: path.basename(pdfPath),
    preview,
  };
}

async function exportMapaZip(filters) {
  const { filePath, preview } = await exportMapaDocx(filters);
  const tempDir = path.dirname(filePath);
  const zipName = `${buildBaseName(filters)}.zip`;
  const zipPath = path.join(tempDir, zipName);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.file(filePath, { name: path.basename(filePath) });
    archive.finalize();
  });

  return {
    filePath: zipPath,
    fileName: zipName,
    preview,
  };
}

module.exports = {
  exportMapaDocx,
  exportMapaPdf,
  exportMapaZip,
};
