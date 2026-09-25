const fs = require("fs");
const path = require("path");

function resolveBuilderExport(builderModule) {
  if (typeof builderModule === "function") return builderModule;
  if (!builderModule) return null;

  const candidates = [
    builderModule.exportarFerias,
    builderModule.buildFeriasDocument,
    builderModule.buildFeriasDocx,
    builderModule.gerarDocumentoFerias,
    builderModule.gerarFeriasDocx,
    builderModule.default,
  ];

  return candidates.find((candidate) => typeof candidate === "function") || null;
}

function getFileNameFromResult(result) {
  const name =
    result?.fileName ||
    result?.filename ||
    result?.name ||
    `ferias_export_${Date.now()}.docx`;

  const fileName = path.basename(String(name));
  return path.extname(fileName) ? fileName : `${fileName}.docx`;
}

async function exportarFerias(req, res) {
  let builderFn;

  try {
    builderFn = resolveBuilderExport(
      require("../utils/feriasTemplateBuilder")
    );
  } catch (error) {
    console.error("[feriasExportService] erro ao carregar o gerador:", error);
    return res.status(500).json({
      ok: false,
      error: "Não foi possível carregar o gerador de férias",
      details: error?.message || String(error),
    });
  }

  if (!builderFn) {
    return res.status(500).json({
      ok: false,
      error: "O gerador de férias não exporta uma função válida",
    });
  }

  try {
    const result = await builderFn({
      body: req.body || {},
      query: req.query || {},
      params: req.params || {},
      headers: req.headers || {},
    });

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

      res.setHeader(
        "Content-Type",
        result.contentType || "application/octet-stream"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send(result.buffer);
    }

    if (result.filePath && typeof result.filePath === "string") {
      const absolutePath = path.resolve(result.filePath);

      if (!fs.existsSync(absolutePath)) {
        return res.status(500).json({
          ok: false,
          error: "O arquivo exportado não existe no disco",
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
      error: "Formato de retorno do gerador não suportado",
    });
  } catch (error) {
    console.error("[feriasExportService] erro na exportação:", error);

    return res.status(500).json({
      ok: false,
      error: "Falha ao gerar exportação de férias",
      details: error?.message || String(error),
    });
  }
}

module.exports = { exportarFerias };
