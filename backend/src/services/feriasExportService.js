const fs = require("fs");
const path = require("path");

function resolveBuilderExport(builderModule) {
  if (!builderModule) return null;

  if (typeof builderModule === "function") return builderModule;

  const candidates = [
    builderModule.exportarFerias,
    builderModule.buildFeriasDocument,
    builderModule.buildFeriasDocx,
    builderModule.gerarDocumentoFerias,
    builderModule.gerarFeriasDocx,
    builderModule.default,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate;
    }
  }

  return null;
}

function getFileNameFromResult(result) {
  const baseName =
    result?.fileName ||
    result?.filename ||
    result?.name ||
    `ferias_export_${Date.now()}.docx`;

  return String(baseName).endsWith(".docx") || String(baseName).endsWith(".pdf")
    ? String(baseName)
    : `${baseName}.docx`;
}

async function exportarFerias(req, res) {
  let builderModule;
  let builderFn;

  try {
    builderModule = require("../utils/feriasTemplateBuilder");
  } catch (error) {
    console.error("[feriasExportService] erro ao carregar ../utils/feriasTemplateBuilder:", error);
    return res.status(500).json({
      ok: false,
      error: "Não foi possível carregar o gerador de template de férias",
      details: error?.message || String(error),
    });
  }

  builderFn = resolveBuilderExport(builderModule);

  if (typeof builderFn !== "function") {
    return res.status(500).json({
      ok: false,
      error: "O módulo feriasTemplateBuilder não exporta uma função válida",
      details:
        "Esperado: module.exports = { exportarFerias } ou função equivalente no builder",
    });
  }

  try {
    const payload = {
      body: req.body || {},
      query: req.query || {},
      params: req.params || {},
      headers: req.headers || {},
    };

    const result = await builderFn(payload);

    if (!result) {
      return res.status(500).json({
        ok: false,
        error: "O gerador de férias não retornou resultado",
      });
    }

    if (Buffer.isBuffer(result)) {
      const fileName = `ferias_export_${Date.now()}.docx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send(result);
    }

    if (result.buffer && Buffer.isBuffer(result.buffer)) {
      const fileName = getFileNameFromResult(result);
      const contentType =
        result.contentType ||
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send(result.buffer);
    }

    if (result.filePath && typeof result.filePath === "string") {
      const absolutePath = path.resolve(result.filePath);

      if (!fs.existsSync(absolutePath)) {
        return res.status(500).json({
          ok: false,
          error: "O arquivo exportado foi informado, mas não existe no disco",
          details: absolutePath,
        });
      }

      const fileName = getFileNameFromResult({
        fileName: result.fileName || path.basename(absolutePath),
      });

      return res.download(absolutePath, fileName);
    }

    if (result.ok && result.downloadUrl) {
      return res.status(200).json(result);
    }

    return res.status(500).json({
      ok: false,
      error: "Formato de retorno do builder não suportado",
      details:
        "Esperado: Buffer, { buffer }, { filePath }, ou objeto com downloadUrl",
    });
  } catch (error) {
    console.error("[feriasExportService] erro na exportação:", error);

    return res.status(500).json({
      ok: false,
      error: "Falha ao gerar exportação de férias",
      details: error?.message || String(error),
      stack: process.env.NODE_ENV === "production" ? undefined : error?.stack,
    });
  }
}

module.exports = { exportarFerias };
