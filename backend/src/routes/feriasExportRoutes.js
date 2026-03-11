const express = require("express");
const { exportarFerias } = require("../services/feriasExportService");

const router = express.Router();

router.get("/exportar", (req, res) => {
  return res.status(405).json({
    ok: false,
    error: "Use POST /api/ferias/exportar para gerar o arquivo de exportação.",
  });
});

router.post("/exportar", async (req, res) => {
  try {
    const payload =
      req.body && typeof req.body === "object" ? req.body : {};

    const result = await exportarFerias(payload);

    if (!result || !result.buffer) {
      return res.status(500).json({
        ok: false,
        error: "A exportação foi processada, mas nenhum arquivo foi gerado.",
      });
    }

    const filename = result.filename || "ferias_exportacao.docx";
    const contentType =
      result.contentType ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );

    return res.status(200).send(result.buffer);
  } catch (error) {
    console.error("❌ Erro em POST /api/ferias/exportar:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Falha ao gerar exportação de férias.";

    let status = 400;
    const normalized = String(message).toLowerCase();

    if (
      normalized.includes("nenhum registro") ||
      normalized.includes("não encontrado") ||
      normalized.includes("nao encontrado")
    ) {
      status = 404;
    } else if (
      normalized.includes("template") ||
      normalized.includes("buffer") ||
      normalized.includes("documento") ||
      normalized.includes("pdf") ||
      normalized.includes("interno")
    ) {
      status = 500;
    }

    return res.status(status).json({
      ok: false,
      error: message,
    });
  }
});

module.exports = router;
