const fs = require('fs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

function renderDocxFromTemplate(templatePath, context) {
  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  doc.render(context);
  return doc.getZip().generate({ type: 'nodebuffer' });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function saveBuffer(filePath, buffer) {
  ensureDir(require('path').dirname(filePath));
  fs.writeFileSync(filePath, buffer);
}

module.exports = {
  renderDocxFromTemplate,
  ensureDir,
  saveBuffer,
};
