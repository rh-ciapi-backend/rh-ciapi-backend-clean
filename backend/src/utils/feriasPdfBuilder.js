const { PDFDocument } = require("pdfkit");

const PAGE_SIZE = 15;
const COLUMNS = [
  { title: "Nº", key: "ordem", width: 24 },
  { title: "NOME DO SERVIDOR", key: "nome", width: 188 },
  { title: "MATRÍCULA", key: "matricula", width: 70 },
  { title: "EXERCÍCIO", key: "exercicio", width: 48 },
  { title: "1º INÍCIO", key: "periodo1_inicio", width: 54 },
  { title: "1º FIM", key: "periodo1_fim", width: 54 },
  { title: "2º INÍCIO", key: "periodo2_inicio", width: 54 },
  { title: "2º FIM", key: "periodo2_fim", width: 54 },
  { title: "3º INÍCIO", key: "periodo3_inicio", width: 54 },
  { title: "3º FIM", key: "periodo3_fim", width: 54 },
  { title: "ASSINATURA", key: "assinatura", width: 120 },
];

function valueOf(value) {
  return String(value ?? "");
}

function drawCell(doc, value, x, y, width, height, header, leftAligned) {
  doc
    .lineWidth(0.5)
    .strokeColor("#334155")
    .fillColor(header ? "#e8edf4" : "#ffffff")
    .rect(x, y, width, height)
    .fillAndStroke();

  doc
    .fillColor("#111827")
    .font(header ? "Helvetica-Bold" : "Helvetica")
    .fontSize(header ? 6.6 : 7)
    .text(valueOf(value), x + 3, y + 6, {
      width: width - 6,
      height: height - 8,
      align: leftAligned ? "left" : "center",
      ellipsis: true,
      lineBreak: false,
    });
}

function drawRow(doc, row, y, header = false) {
  const xStart = doc.page.margins.left;
  const height = header ? 32 : 25;
  let x = xStart;

  for (const column of COLUMNS) {
    drawCell(
      doc,
      header ? column.title : row?.[column.key],
      x,
      y,
      column.width,
      height,
      header,
      column.key === "nome"
    );
    x += column.width;
  }

  return y + height;
}

function drawPage(doc, rows, filters, pageNumber, totalPages, totalRows) {
  doc.addPage();

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  doc.font("Helvetica-Bold").fillColor("#111827");
  doc.fontSize(11).text("GOVERNO DO ESTADO DE RORAIMA", left, 30, {
    width,
    align: "center",
  });
  doc.fontSize(8).text(
    "SECRETARIA DE ESTADO DO TRABALHO E BEM-ESTAR SOCIAL",
    left,
    47,
    { width, align: "center" }
  );
  doc.text(
    "CENTRO INTEGRADO DE ATENÇÃO À PESSOA IDOSA - CIAPI",
    left,
    59,
    { width, align: "center" }
  );
  doc.fontSize(11).text(
    `PROGRAMAÇÃO ANUAL DE FÉRIAS - EXERCÍCIO/${valueOf(filters.ano)}`,
    left,
    77,
    { width, align: "center" }
  );

  doc.font("Helvetica").fontSize(7.5).text(
    `Categoria: ${valueOf(filters.categoria)}    ` +
      `Setor: ${valueOf(filters.setor)}    ` +
      `Status: ${valueOf(filters.status)}    ` +
      `Página: ${pageNumber}/${totalPages}    ` +
      `Total: ${totalRows}`,
    left,
    100,
    { width }
  );

  let y = drawRow(doc, null, 121, true);

  if (!rows.length) {
    drawRow(doc, { nome: "NENHUM REGISTRO ENCONTRADO" }, y);
    return;
  }

  for (const row of rows) {
    y = drawRow(doc, row, y);
  }
}

function buildFeriasPdf(rows, filters) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 28,
      autoFirstPage: false,
      compress: true,
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pages = [];

    for (let i = 0; i < rows.length; i += PAGE_SIZE) {
      pages.push(rows.slice(i, i + PAGE_SIZE));
    }
    if (!pages.length) pages.push([]);

    pages.forEach((pageRows, index) => {
      drawPage(
        doc,
        pageRows,
        filters,
        index + 1,
        pages.length,
        rows.length
      );
    });

    doc.end();
  });
}

module.exports = { buildFeriasPdf };
