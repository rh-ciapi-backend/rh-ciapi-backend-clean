const express = require('express');
const { getMapaPreview } = require('../services/mapasService');

const router = express.Router();

router.get('/preview', async (req, res) => {
  try {
    const filters = {
      mes: Number(req.query.mes),
      ano: Number(req.query.ano),
      categoria: req.query.categoria || '',
      setor: req.query.setor || '',
      status: req.query.status || 'ATIVO',
      layout: req.query.layout || 'automatico',
      modoExportacao: req.query.modoExportacao || 'arquivo_unico',
    };

    const payload = await getMapaPreview(filters);
    res.json(payload);
  } catch (error) {
    console.error('[mapas/preview]', error);
    res.status(500).json({ ok: false, message: error.message || 'Erro ao montar preview do mapa.' });
  }
});

router.post('/validar', async (req, res) => {
  try {
    const payload = await getMapaPreview(req.body || {});
    res.json(payload);
  } catch (error) {
    console.error('[mapas/validar]', error);
    res.status(500).json({ ok: false, message: error.message || 'Erro ao validar dados do mapa.' });
  }
});

module.exports = router;
