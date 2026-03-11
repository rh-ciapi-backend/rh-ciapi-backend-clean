const express = require("express");
const router = express.Router();

const { exportarFerias } = require("../services/feriasExportService");

router.post("/exportar", async (req, res) => {
  try {
    return await exportarFerias(req, res);
  } catch (error) {
    console.error("[feriasExportRoutes] erro ao exportar férias:", error);

    if (res.headersSent) {
      return;
    }

    return res.status(500).json({
      ok: false,
      error: "Erro interno ao exportar férias",
      details: error?.message || String(error),
    });
  }
});

module.exports = router;
