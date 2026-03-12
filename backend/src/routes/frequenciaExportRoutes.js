'use strict';

const express = require('express');
const { exportarFrequencia } = require('../services/frequenciaExportService');

const router = express.Router();

router.get('/exportar/health', async (_req, res) => {
  return res.json({
    ok: true,
    route: '/api/frequencia/exportar',
    method: 'POST'
  });
});

router.post('/exportar', async (req, res) => {
  try {
    const {
      templateData,
      formato,
      templatePath,
      outputFileName,
      removerLinhasExcedentes
    } = req.body || {};

    if (!templateData || typeof templateData !== 'object') {
      return res.status(400).json({
        ok: false,
        error: 'templateData é obrigatório para exportar a frequência.'
      });
    }

    const result = await exportarFrequencia({
      templateData,
      formato,
      templatePath,
      outputFileName,
      removerLinhasExcedentes: removerLinhasExcedentes !== false
    });

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.filename)}"`
    );

    return res.send(result.buffer);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Falha ao exportar frequência',
      details: error?.message || 'Erro interno'
    });
  }
});

module.exports = router;
