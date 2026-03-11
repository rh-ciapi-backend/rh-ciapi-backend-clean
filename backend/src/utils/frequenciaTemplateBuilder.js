const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function sanitizeFileName(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || 'ARQUIVO';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function buildTemplateData(payload) {
  const data = {
    NOME: payload?.servidor?.nome || '',
    NOME_SERVIDOR: payload?.servidor?.nome || '',
    MATRICULA: payload?.servidor?.matricula || '',
    CPF: payload?.servidor?.cpf || '',
    CARGO: payload?.servidor?.cargo || '',
    SETOR: payload?.servidor?.setor || '',
    CATEGORIA: payload?.servidor?.categoria || '',
    MES: payload?.competencia?.mesExtenso || '',
    ANO: String(payload?.competencia?.ano || ''),
    CH_DIARIA: payload?.servidor?.chDiaria
      ? `CH_DIARIA: ${payload.servidor.chDiaria}`
      : '',
    CH_SEMANAL: payload?.servidor?.chSemanal
      ? `CH_SEMANAL: ${payload.servidor.chSemanal}`
      : '',
  };

  const linhas = Array.isArray(payload?.linhas) ? payload.linhas : [];
  const diasNoMes = Number(payload?.competencia?.diasNoMes || 31);

  for (let dia = 1; dia <= 31; dia += 1) {
    const item = linhas.find((l) => Number(l.dia) === dia);

    data[`D${dia}`] = dia <= diasNoMes ? String(dia) : '';
    data[`S${dia}`] = item?.descricao || '';
    data[`O1_${dia}`] = '';
    data[`O2_${dia}`] = '';
    data[`T${dia}`] = '';

    data[`DATA_${dia}`] = dia <= diasNoMes
      ? `${pad2(dia)}/${pad2(payload?.competencia?.mes || 0)}/${payload?.competencia?.ano || ''}`
      : '';
  }

  return data;
}

async function gerarDocxFrequencia({ templatePath, outputPath, payload }) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Modelo DOCX não encontrado em: ${templatePath}`);
  }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  const templateData = buildTemplateData(payload);
  doc.render(templateData);

  const buffer = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

async function gerarCsvFrequencia({ outputPath, payload }) {
  const header = [
    'Servidor',
    'Matrícula',
    'CPF',
    'Cargo',
    'Setor',
    'Categoria',
    'Mês',
    'Ano',
    'Dia',
    'Data',
    'Ocorrências',
  ];

  const linhas = Array.isArray(payload?.linhas) ? payload.linhas : [];

  const rows = [
    header,
    ...linhas.map((item) => [
      payload?.servidor?.nome || '',
      payload?.servidor?.matricula || '',
      payload?.servidor?.cpf || '',
      payload?.servidor?.cargo || '',
      payload?.servidor?.setor || '',
      payload?.servidor?.categoria || '',
      payload?.competencia?.mesExtenso || '',
      String(payload?.competencia?.ano || ''),
      String(item?.dia || ''),
      item?.dataIso || '',
      item?.descricao || '',
    ]),
  ];

  const csv = '\uFEFF' + rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? '');
          return `"${text.replace(/"/g, '""')}"`;
        })
        .join(';')
    )
    .join('\n');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, csv, 'utf8');

  return outputPath;
}

module.exports = {
  gerarDocxFrequencia,
  gerarCsvFrequencia,
  sanitizeFileName,
};
