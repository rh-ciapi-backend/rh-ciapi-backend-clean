'use strict';

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const libre = require('libreoffice-convert');

libre.convertAsync = require('util').promisify(libre.convert);

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFilename(input) {
  return String(input || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveTemplatePath(customTemplatePath) {
  const candidates = [
    customTemplatePath,
    process.env.CIAPI_FREQUENCIA_TEMPLATE,
    path.resolve(process.cwd(), 'backend/templates/modelo_frequencia.docx'),
    path.resolve(process.cwd(), 'backend/templates/frequencia/modelo_frequencia.docx'),
    path.resolve(process.cwd(), 'templates/modelo_frequencia.docx'),
    path.resolve(process.cwd(), 'templates/frequencia/modelo_frequencia.docx')
  ].filter(Boolean);

  const found = candidates.find((candidate) => fileExists(candidate));
  if (!found) {
    throw new Error('Modelo oficial de frequência não encontrado.');
  }

  return found;
}

function readDocxBuffer(templatePath) {
  return fs.readFileSync(templatePath);
}

function buildRowPatternForDay(day) {
  const plainDay = `D${day}`;
  const plainRubrica = `S${day}`;
  const o1 = `O1_${day}`;
  const o2 = `O2_${day}`;

  return new RegExp(
    `<w:tr[\\s\\S]*?(?:\\{\\{\\s*${plainDay}\\s*\\}\\}|\\{\\s*${plainDay}\\s*\\}|${plainDay}|\\{\\{\\s*${plainRubrica}\\s*\\}\\}|\\{\\s*${plainRubrica}\\s*\\}|${plainRubrica}|\\{\\{\\s*${o1}\\s*\\}\\}|\\{\\s*${o1}\\s*\\}|${o1}|\\{\\{\\s*${o2}\\s*\\}\\}|\\{\\s*${o2}\\s*\\}|${o2})[\\s\\S]*?<\\/w:tr>`,
    'g'
  );
}

function removeExcessRowsFromXml(xml, lastDay) {
  if (!xml || !lastDay || lastDay >= 31) return xml;

  let nextXml = xml;

  for (let day = 31; day > lastDay; day -= 1) {
    const rowPattern = buildRowPatternForDay(day);
    nextXml = nextXml.replace(rowPattern, '');
  }

  return nextXml;
}

function removeExcessRowsFromDocxBuffer(docxBuffer, lastDay) {
  if (!lastDay || lastDay >= 31) {
    return docxBuffer;
  }

  const zip = new PizZip(docxBuffer);
  const documentXmlPath = 'word/document.xml';

  const docFile = zip.file(documentXmlPath);
  if (!docFile) return docxBuffer;

  const originalXml = docFile.asText();
  const updatedXml = removeExcessRowsFromXml(originalXml, lastDay);

  zip.file(documentXmlPath, updatedXml);

  return zip.generate({ type: 'nodebuffer' });
}

function createDocxtemplaterInstance(zip) {
  return new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: {
      start: '{{',
      end: '}}'
    },
    nullGetter() {
      return '';
    }
  });
}

function reduceFontForSpecificTermsInXml(xml) {
  if (!xml || typeof xml !== 'string') return xml;

  const replacements = [
    {
      term: 'PONTO FACULTATIVO',
      halfPoints: 14,
      ascii: 'PONTO FACULTATIVO'
    }
  ];

  let nextXml = xml;

  replacements.forEach(({ term, halfPoints, ascii }) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const pattern = new RegExp(
      `(<w:r[^>]*>[\\s\\S]*?<w:t[^>]*>)(${escaped})(<\\/w:t>[\\s\\S]*?<\\/w:r>)`,
      'g'
    );

    nextXml = nextXml.replace(pattern, (match, openTag, textValue, closeTag) => {
      if (/<w:rPr>[\s\S]*?<w:sz\b[^>]*w:val="14"[\s\S]*?<\/w:rPr>/.test(match)) {
        return match;
      }

      if (/<w:rPr>/.test(match)) {
        return match.replace(
          /<w:rPr>([\s\S]*?)<\/w:rPr>/,
          `<w:rPr>$1<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr>`
        );
      }

      return `${openTag.replace(
        /<w:t[^>]*>$/,
        `<w:rPr><w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr>$&`
      )}${textValue}${closeTag}`;
    });

    if (ascii && ascii !== term) {
      const asciiPattern = new RegExp(
        `(<w:r[^>]*>[\\s\\S]*?<w:t[^>]*>)(${ascii.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(<\\/w:t>[\\s\\S]*?<\\/w:r>)`,
        'g'
      );

      nextXml = nextXml.replace(asciiPattern, (match, openTag, textValue, closeTag) => {
        if (/<w:rPr>[\s\S]*?<w:sz\b[^>]*w:val="14"[\s\S]*?<\/w:rPr>/.test(match)) {
          return match;
        }

        if (/<w:rPr>/.test(match)) {
          return match.replace(
            /<w:rPr>([\s\S]*?)<\/w:rPr>/,
            `<w:rPr>$1<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr>`
          );
        }

        return `${openTag.replace(
          /<w:t[^>]*>$/,
          `<w:rPr><w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr>$&`
        )}${textValue}${closeTag}`;
      });
    }
  });

  return nextXml;
}

function applyRubricaCompactionToDocxBuffer(docxBuffer) {
  const zip = new PizZip(docxBuffer);
  const documentXmlPath = 'word/document.xml';
  const docFile = zip.file(documentXmlPath);

  if (!docFile) return docxBuffer;

  const originalXml = docFile.asText();
  const updatedXml = reduceFontForSpecificTermsInXml(originalXml);

  if (updatedXml !== originalXml) {
    zip.file(documentXmlPath, updatedXml);
    return zip.generate({ type: 'nodebuffer' });
  }

  return docxBuffer;
}

function renderDocxTemplate(docxBuffer, templateData) {
  const zip = new PizZip(docxBuffer);
  const doc = createDocxtemplaterInstance(zip);

  try {
    doc.render(templateData || {});
  } catch (error) {
    const detail = error?.properties?.errors
      ? error.properties.errors.map((e) => e.properties?.explanation || e.name).join(' | ')
      : error?.message || 'Erro ao renderizar DOCX';
    throw new Error(detail);
  }

  const renderedBuffer = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  });

  return applyRubricaCompactionToDocxBuffer(renderedBuffer);
}

async function convertDocxBufferToPdf(docxBuffer) {
  return libre.convertAsync(docxBuffer, '.pdf', undefined);
}

function saveOutputBuffer(outputDir, filename, buffer) {
  ensureDir(outputDir);
  const absolutePath = path.join(outputDir, filename);
  fs.writeFileSync(absolutePath, buffer);
  return absolutePath;
}

module.exports = {
  ensureDir,
  sanitizeFilename,
  resolveTemplatePath,
  readDocxBuffer,
  removeExcessRowsFromDocxBuffer,
  renderDocxTemplate,
  convertDocxBufferToPdf,
  saveOutputBuffer,
  applyRubricaCompactionToDocxBuffer
};
