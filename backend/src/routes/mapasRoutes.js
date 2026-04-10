const express = require('express');
const { getMapaPreview } = require('../services/mapasService');

const router = express.Router();

function normalizeFilters(source = {}) {
  return {
    mes: Number(source.mes) || new Date().getMonth() + 1,
    ano: Number(source.ano) || new Date().getFullYear(),
    categoria: String(source.categoria || '').trim(),
    setor: String(source.setor || '').trim(),
    status: String(source.status || 'ATIVO').trim().toUpperCase(),
    layout: String(source.layout || 'automatico').trim(),
    modoExportacao: String(source.modoExportacao || 'arquivo_unico').trim(),
  };
}

router.get('/preview', async (req, res) => {
  try {
    const filters = normalizeFilters(req.query || {});
    const payload = await getMapaPreview(filters);
    return res.json(payload);
  } catch (error) {
    console.error('[mapas/preview]', error);
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : 'Erro ao montar preview do mapa.',
    });
  }
});

router.post('/validar', async (req, res) => {
  try {
    const filters = normalizeFilters(req.body || {});
    const payload = await getMapaPreview(filters);
    return res.json(payload);
  } catch (error) {
    console.error('[mapas/validar]', error);
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : 'Erro ao validar dados do mapa.',
    });
  }
});

module.exports = router;
