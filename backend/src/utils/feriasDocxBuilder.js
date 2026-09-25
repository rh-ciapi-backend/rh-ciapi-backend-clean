const PizZip = require("pizzip");

function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraph(value, options = {}) {
  const align = options.center ? "center" : "left";
  const size = options.size || 16;
  const bold = options.bold ? "<w:b/>" : "";

  return `
    <w:p>
      <w:pPr>
        <w:jc w:val="${align}"/>
        <w:spacing w:after="${options.after ?? 80}"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          ${bold}
          <w:sz w:val="${size}"/>
          <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>
        </w:rPr>
        <w:t xml:space="preserve">${xml(value)}</w:t>
      </w:r>
    </w:p>`;
}

function cell(value, width, options = {}) {
  return `
    <w:tc>
      <w:tcPr>
        <w:tcW w:w="${width}" w:type="dxa"/>
        ${options.header ? '<w:shd w:fill="E8EDF4"/>' : ""}
      </w:tcPr>
      ${paragraph(value, {
        center: options.center,
        bold: options.header,
        size: options.header ? 14 : 15,
        after: 0,
      })}
    </w:tc>`;
}

const widths = [500, 3800, 1400, 1000, 950, 950, 950, 950, 950, 950, 3000];

function tableRow(values, header = false) {
  const cells = widths
    .map((width, index) =>
      cell(values[index] ?? "", width, {
        header,
        center: index !== 1,
      })
    )
    .join("");

  return `
    <w:tr>
      <w:trPr>
        <w:cantSplit/>
        ${header ? "<w:tblHeader/>" : ""}
      </w:trPr>
      ${cells}
    </w:tr>`;
}

function table(rows) {
  const headings = [
    "Nº",
    "NOME DO SERVIDOR",
    "MATRÍCULA",
    "EXERCÍCIO",
    "1º INÍCIO",
    "1º TÉRMINO",
    "2º INÍCIO",
    "2º TÉRMINO",
    "3º INÍCIO",
    "3º TÉRMINO",
    "ASSINATURA",
  ];

  const body = rows.length
    ? rows.map((row) =>
        tableRow([
          row.ordem,
          row.nome,
          row.matricula,
          row.exercicio,
          row.periodo1_inicio,
          row.periodo1_fim,
          row.periodo2_inicio,
          row.periodo2_fim,
          row.periodo3_inicio,
          row.periodo3_fim,
          "",
        ])
      ).join("")
    : tableRow(["", "NENHUM REGISTRO ENCONTRADO"]);

  return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="15400" w:type="dxa"/>
        <w:tblLayout w:type="fixed"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6"/>
          <w:left w:val="single" w:sz="6"/>
          <w:bottom w:val="single" w:sz="6"/>
          <w:right w:val="single" w:sz="6"/>
          <w:insideH w:val="single" w:sz="6"/>
          <w:insideV w:val="single" w:sz="6"/>
        </w:tblBorders>
        <w:tblCellMar>
          <w:top w:w="70" w:type="dxa"/>
          <w:bottom w:w="70" w:type="dxa"/>
          <w:left w:w="70" w:type="dxa"/>
          <w:right w:w="70" w:type="dxa"/>
        </w:tblCellMar>
      </w:tblPr>
      <w:tblGrid>${widths.map((width) =>
        `<w:gridCol w:w="${width}"/>`
      ).join("")}</w:tblGrid>
      ${tableRow(headings, true)}
      ${body}
    </w:tbl>`;
}

function pageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function monthName(month) {
  const names = [
    "Todos os meses", "Janeiro", "Fevereiro", "Março", "Abril",
    "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro",
    "Novembro", "Dezembro",
  ];
  return names[Number(month)] || names[0];
}

function buildFeriasDocx(rows, filters) {
  const pages = [];

  for (let i = 0; i < rows.length; i += 18) {
    pages.push(rows.slice(i, i + 18));
  }
  if (!pages.length) pages.push([]);

  const content = pages.map((pageRows, index) => {
    const heading = [
      paragraph("GOVERNO DO ESTADO DE RORAIMA", {
        center: true, bold: true, size: 20, after: 20,
      }),
      paragraph("SECRETARIA DE ESTADO DO TRABALHO E BEM-ESTAR SOCIAL", {
        center: true, bold: true, size: 16, after: 20,
      }),
      paragraph("CENTRO INTEGRADO DE ATENÇÃO À PESSOA IDOSA - CIAPI", {
        center: true, bold: true, size: 16, after: 100,
      }),
      paragraph(`PROGRAMAÇÃO ANUAL DE FÉRIAS - EXERCÍCIO/${filters.ano}`, {
        center: true, bold: true, size: 22, after: 100,
      }),
      paragraph(`Categoria: ${filters.categoria}    Setor: ${filters.setor}`, {
        bold: true, size: 16,
      }),
      paragraph(
        `Status: ${filters.status}    Mês: ${monthName(filters.mes)}    ` +
        `Página: ${index + 1}/${pages.length}    Total: ${rows.length}`,
        { size: 15, after: 120 }
      ),
    ].join("");

    return `${index ? pageBreak() : ""}${heading}${table(pageRows)}`;
  }).join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        ${content}
        <w:sectPr>
          <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
          <w:pgMar w:top="620" w:right="700" w:bottom="620" w:left="700"
                   w:header="300" w:footer="300" w:gutter="0"/>
        </w:sectPr>
      </w:body>
    </w:document>`;

  const zip = new PizZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
     <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
       <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
       <Default Extension="xml" ContentType="application/xml"/>
       <Override PartName="/word/document.xml"
         ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
     </Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
     <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
       <Relationship Id="rId1"
         Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
         Target="word/document.xml"/>
     </Relationships>`
  );

  zip.file("word/document.xml", documentXml);

  return zip.generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}

module.exports = { buildFeriasDocx };
