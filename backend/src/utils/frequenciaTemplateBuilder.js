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

function weekdayLabelFromIso(iso) {
  if (!iso) return '';
  const dt = new Date(`${iso}T12:00:00`);
  const wd = dt.getDay();
  if (wd === 6) return 'SÁBADO';
  if (wd === 0) return 'DOMINGO';
  return '';
}

function splitManualOccurrences(items = []) {
  const normalized = items
    .map((item) => ({
      tipo: normalizeText(item?.tipo).toUpperCase(),
      turno: normalizeText(item?.turno).toUpperCase(),
      descricao: normalizeText(item?.descricao),
    }))
    .filter((item) => item.tipo || item.descricao);

  const o1 = [];
  const o2 = [];
  const extras = [];

  for (const item of normalized) {
    const turno = item.turno;
    const tipo = item.tipo;
    const descricao = item.descricao;

    const base = [tipo, descricao].filter(Boolean).join(descricao && tipo ? ' - ' : '');
    const texto = base || tipo || descricao;

    if (!texto) continue;

    if (turno === 'MANHA' || turno === 'MANHÃ') {
      o1.push(texto);
    } else if (turno === 'TARDE') {
      o2.push(texto);
    } else if (turno === 'INTEGRAL') {
      o1.push(texto);
      o2.push(texto);
    } else {
      extras.push(texto);
    }
  }

  return {
    o1: o1.join(' / '),
    o2: o2.join(' / '),
    extras: extras.join(' / '),
  };
}

function buildTemplateData(payload) {
  const data = {};

  const servidor = payload?.servidor || {};
  const competencia = payload?.competencia || {};
  const linhas = Array.isArray(payload?.linhas) ? payload.linhas : [];
  const diasNoMes = Number(competencia?.diasNoMes || 31);

  data.NOME = normalizeText(servidor?.nome);
  data.MATRICULA = normalizeText(servidor?.matricula);
  data.CPF = normalizeText(servidor?.cpf);
  data.CARGO = normalizeText(servidor?.cargo);
  data.CATEGORIA = normalizeText(servidor?.categoria);
  data.MES = normalizeText(competencia?.mesExtenso);
  data.ANO = String(competencia?.ano || '');
  data.CH_DIARIA = normalizeText(servidor?.chDiaria)
    ? `CH_DIARIA: ${normalizeText(servidor?.chDiaria)}`
    : '';
  data.CH_SEMANAL = normalizeText(servidor?.chSemanal)
    ? `CH_SEMANAL: ${normalizeText(servidor?.chSemanal)}`
    : '';

  for (let dia = 1; dia <= 31; dia += 1) {
    const item = linhas.find((l) => Number(l?.dia) === dia);

    if (dia > diasNoMes) {
      data[String(dia)] = '';
      data[`T${dia}`] = '';
      data[`S${dia}`] = '';
      data[`O1_${dia}`] = '';
      data[`O2_${dia}`] = '';
      continue;
    }

    const iso = normalizeText(item?.dataIso);
    const turnoTexto = normalizeText(item?.turnoTexto);
    const rubrica = normalizeText(item?.rubrica);
    const manual = Array.isArray(item?.ocorrenciasManuais) ? item.ocorrenciasManuais : [];
    const splitted = splitManualOccurrences(manual);
    const weekend = weekdayLabelFromIso(iso);

    data[String(dia)] = String(dia);
    data[`T${dia}`] = turnoTexto || formatDateBR(iso);
    data[`S${dia}`] = rubrica || weekend || '';
    data[`O1_${dia}`] = splitted.o1 || '';
    data[`O2_${dia}`] = splitted.o2 || '';

    if (!data[`S${dia}`] && splitted.extras) {
      data[`S${dia}`] = splitted.extras;
    } else if (data[`S${dia}`] && splitted.extras) {
      data[`S${dia}`] = `${data[`S${dia}`]} / ${splitted.extras}`;
    }
  }

  return data;
}

async function gerarDocxFrequencia({ templatePath, outputPath, payload }) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Modelo DOCX não encontrado em: ${templatePath}`);
  }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);

  let doc;
  try {
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });
  } catch (error) {
    throw new Error(`Falha ao abrir o modelo DOCX: ${error.message}`);
  }

  const templateData = buildTemplateData(payload);

  try {
    doc.render(templateData);
  } catch (error) {
    const explanation =
      error?.properties?.errors
        ?.map((e) => e.properties?.explanation || e.message)
        ?.join(' | ') || error.message;

    throw new Error(`Falha ao preencher placeholders da frequência: ${explanation}`);
  }

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
    'Categoria',
    'Mês',
    'Ano',
    'Dia',
    'Data',
    'Turno/Referência',
    'Rubrica',
    'Ocorrência 1',
    'Ocorrência 2',
  ];

  const linhas = Array.isArray(payload?.linhas) ? payload.linhas : [];

  const rows = [
    header,
    ...linhas.map((item) => {
      const manual = Array.isArray(item?.ocorrenciasManuais) ? item.ocorrenciasManuais : [];
      const splitted = splitManualOccurrences(manual);

      return [
        normalizeText(payload?.servidor?.nome),
        normalizeText(payload?.servidor?.matricula),
        normalizeText(payload?.servidor?.cpf),
        normalizeText(payload?.servidor?.cargo),
        normalizeText(payload?.servidor?.categoria),
        normalizeText(payload?.competencia?.mesExtenso),
        String(payload?.competencia?.ano || ''),
        String(item?.dia || ''),
        normalizeText(item?.dataIso),
        normalizeText(item?.turnoTexto || formatDateBR(item?.dataIso)),
        normalizeText(item?.rubrica),
        splitted.o1,
        splitted.o2,
      ];
    }),
  ];

  const csv =
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
          .join(';'),
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
  buildTemplateData,
};
