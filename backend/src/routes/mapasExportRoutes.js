const express = require('express');
const fs = require('fs');
const { exportMapaDocx, exportMapaPdf, exportMapaZip } = require('../services/mapasExportService');

const router = express.Router();

router.post('/exportar/docx', async (req, res) => {
  try {
    const result = await exportMapaDocx(req.body || {});
    res.download(result.filePath, result.fileName, () => {
      try { fs.unlinkSync(result.filePath); } catch {}
    });
  } catch (error) {
    console.error('[mapas/exportar/docx]', error);
    res.status(500).send(error.message || 'Erro ao exportar DOCX do mapa.');
  }
});

router.post('/exportar/pdf', async (req, res) => {
  try {
    const result = await exportMapaPdf(req.body || {});
    res.download(result.filePath, result.fileName, () => {
      try { fs.unlinkSync(result.filePath); } catch {}
    });
  } catch (error) {
    console.error('[mapas/exportar/pdf]', error);
    res.status(500).send(error.message || 'Erro ao exportar PDF do mapa.');
  }
});

router.post('/exportar/zip', async (req, res) => {
  try {
    const result = await exportMapaZip(req.body || {});
    res.download(result.filePath, result.fileName, () => {
      try { fs.unlinkSync(result.filePath); } catch {}
    });
  } catch (error) {
    console.error('[mapas/exportar/zip]', error);
    res.status(500).send(error.message || 'Erro ao exportar ZIP do mapa.');
  }
});

module.exports = router;
