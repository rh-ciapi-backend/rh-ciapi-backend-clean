const express = require('express');
const { exportarFrequencia } = require('../services/frequenciaExportService');

const router = express.Router();

/**
 * POST /api/frequencia/exportar
 * Body:
 * {
 *   ano: 2026,
 *   mes: 1,
 *   servidorId?: "...",
 *   servidorCpf?: "00000000000",
 *   formato: "docx" | "pdf"
 * }
 */
router.post('/exportar', async (req, res) => {
  try {
    const { ano, mes, servidorId, servidorCpf, formato } = req.body || {};

    const result = await exportarFrequencia({
      ano,
      mes,
      servidorId,
      servidorCpf,
      formato,
    });

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`
    );
    res.setHeader('Content-Length', result.buffer.length);

    return res.status(200).send(result.buffer);
  } catch (error) {
    console.error('[POST /api/frequencia/exportar] erro:', error);

    const message = error?.message || 'Erro interno ao exportar frequência';
    const status =
      message.includes('obrigatório') ||
      message.includes('Formato inválido') ||
      message.includes('Informe servidorId ou servidorCpf')
        ? 400
        : message.includes('não encontrado') ||
          message.includes('Não foi possível localizar')
        ? 404
        : message.includes('LibreOffice/soffice')
        ? 503
        : 500;

    return res.status(status).json({
      ok: false,
      error: 'Erro ao exportar frequência',
      details: message,
    });
  }
});

module.exports = router;
