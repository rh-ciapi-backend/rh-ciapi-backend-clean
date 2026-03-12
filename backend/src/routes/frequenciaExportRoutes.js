'use strict';

const express = require('express');
const { exportarFrequencia } = require('../services/frequenciaExportService');

const router = express.Router();

function resolveFormato(req) {
  const formatoBody = String(req.body?.formato || '').trim().toLowerCase();
  const formatoParam = String(req.params?.formato || '').trim().toLowerCase();
  return formatoBody || formatoParam || 'docx';
}

function buildContentDisposition(filename) {
  const safeName = String(filename || 'frequencia.docx').replace(/[\r\n"]/g, '_');
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

async function handleExport(req, res) {
  try {
    const {
      templateData,
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
      formato: resolveFormato(req),
      templatePath,
      outputFileName,
      removerLinhasExcedentes: removerLinhasExcedentes !== false
    });

    res.setHeader('Content-Type', result.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', buildContentDisposition(result.filename));

    return res.send(result.buffer);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Falha ao exportar frequência',
      details: error?.message || 'Erro interno'
    });
  }
}

router.get('/exportar/health', async (_req, res) => {
  return res.json({
    ok: true,
    routes: [
      'POST /api/frequencia/exportar',
      'POST /api/frequencia/exportar/:formato'
    ]
  });
});

router.post('/exportar', handleExport);
router.post('/exportar/:formato', handleExport);

module.exports = router;
