'use strict';

const path = require('path');
const {
  sanitizeFilename,
  resolveTemplatePath,
  readDocxBuffer,
  removeExcessRowsFromDocxBuffer,
  renderDocxTemplate,
  convertDocxBufferToPdf,
  saveOutputBuffer
} = require('../utils/frequenciaDocxHelper');

function normalizeFormato(value) {
  const raw = String(value || 'docx').trim().toLowerCase();
  return raw === 'pdf' ? 'pdf' : 'docx';
}

function normalizeTemplateData(templateData) {
  return templateData && typeof templateData === 'object' ? templateData : {};
}

function buildDefaultOutputFileName(templateData, formato) {
  const nome = String(templateData.NOME || 'servidor').trim();
  const mes = String(templateData.MES_NUMERO || '').trim() || String(templateData.MES || 'MES').trim();
  const ano = String(templateData.ANO || 'ANO').trim();

  const base = sanitizeFilename(`frequencia_${nome}_${mes}_${ano}`) || 'frequencia';
  return `${base}.${formato}`;
}

function getLastDayFromTemplateData(templateData) {
  const n = Number(templateData.LAST_DAY || 31);
  return Number.isFinite(n) && n >= 1 && n <= 31 ? n : 31;
}

async function exportarFrequencia({
  templateData,
  formato,
  templatePath,
  outputFileName,
  removerLinhasExcedentes = true
}) {
  const safeFormato = normalizeFormato(formato);
  const safeTemplateData = normalizeTemplateData(templateData);
  const lastDay = getLastDayFromTemplateData(safeTemplateData);

  const resolvedTemplatePath = resolveTemplatePath(templatePath);
  let templateBuffer = readDocxBuffer(resolvedTemplatePath);

  if (removerLinhasExcedentes) {
    templateBuffer = removeExcessRowsFromDocxBuffer(templateBuffer, lastDay);
  }

  const docxBuffer = renderDocxTemplate(templateBuffer, safeTemplateData);

  const finalFileName = sanitizeFilename(
    outputFileName || buildDefaultOutputFileName(safeTemplateData, safeFormato)
  ) || `frequencia.${safeFormato}`;

  const exportDir =
    process.env.EXPORT_DIR
      ? path.join(process.env.EXPORT_DIR, 'frequencia')
      : path.resolve(process.cwd(), 'backend/exports/frequencia');

  if (safeFormato === 'pdf') {
    const pdfBuffer = await convertDocxBufferToPdf(docxBuffer);
    const pdfFileName = finalFileName.endsWith('.pdf')
      ? finalFileName
      : finalFileName.replace(/\.docx$/i, '') + '.pdf';

    const absolutePath = saveOutputBuffer(exportDir, pdfFileName, pdfBuffer);

    return {
      ok: true,
      formato: 'pdf',
      filename: pdfFileName,
      absolutePath,
      mimeType: 'application/pdf',
      buffer: pdfBuffer
    };
  }

  const docxFileName = finalFileName.endsWith('.docx')
    ? finalFileName
    : finalFileName.replace(/\.pdf$/i, '') + '.docx';

  const absolutePath = saveOutputBuffer(exportDir, docxFileName, docxBuffer);

  return {
    ok: true,
    formato: 'docx',
    filename: docxFileName,
    absolutePath,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxBuffer
  };
}

module.exports = {
  exportarFrequencia
};
