async function exportarFeriasTemplate(payload = {}) {
  const content = `
CIAPI RH - EXPORTAÇÃO DE FÉRIAS

Payload recebido com sucesso.

Filtros:
${JSON.stringify(payload, null, 2)}
`.trim();

  return {
    buffer: Buffer.from(content, "utf-8"),
    fileName: "ferias_export_teste.docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

module.exports = exportarFeriasTemplate;
