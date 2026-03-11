const express = require('express');
const { exportarFrequencia } = require('../services/frequenciaExportService');

const router = express.Router();

router.post('/exportar/:formato', async (req, res) => {
  try {
    const formato = String(req.params.formato || '').toLowerCase();

    if (!['docx', 'pdf', 'csv'].includes(formato)) {
      return res.status(400).json({
        ok: false,
        error: 'Formato inválido. Use docx, pdf ou csv.',
      });
    }

    const resultado = await exportarFrequencia({
      formato,
      body: req.body || {},
    });

    if (resultado.kind === 'json') {
      return res.status(resultado.statusCode || 200).json(resultado.payload);
    }

    if (resultado.kind === 'download') {
      res.setHeader('Content-Type', resultado.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${resultado.fileName}"`);
      return res.sendFile(resultado.filePath);
    }

    return res.status(500).json({
      ok: false,
      error: 'Resposta de exportação inválida.',
    });
  } catch (error) {
    console.error('[frequenciaExportRoutes] erro:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro interno ao exportar frequência',
      details: error?.message || String(error),
    });
  }
});

module.exports = router;
