const express = require('express');
const {
  listarFrequencia,
  obterOcorrenciaPorId,
  criarOcorrencia,
  atualizarOcorrencia,
  excluirOcorrencia,
} = require('../services/frequenciaService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const data = await listarFrequencia(req.query || {});
    return res.status(200).json(data);
  } catch (error) {
    console.error('[frequenciaRoutes][GET /] erro:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao listar frequência',
      details: error?.message || String(error),
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const data = await obterOcorrenciaPorId(req.params.id);

    if (!data) {
      return res.status(404).json({
        ok: false,
        error: 'Ocorrência não encontrada',
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('[frequenciaRoutes][GET /:id] erro:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao buscar ocorrência',
      details: error?.message || String(error),
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const data = await criarOcorrencia(req.body || {});
    return res.status(201).json(data);
  } catch (error) {
    console.error('[frequenciaRoutes][POST /] erro:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao criar ocorrência',
      details: error?.message || String(error),
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const data = await atualizarOcorrencia(req.params.id, req.body || {});
    return res.status(200).json(data);
  } catch (error) {
    console.error('[frequenciaRoutes][PUT /:id] erro:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao atualizar ocorrência',
      details: error?.message || String(error),
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await excluirOcorrencia(req.params.id);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[frequenciaRoutes][DELETE /:id] erro:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao excluir ocorrência',
      details: error?.message || String(error),
    });
  }
});

module.exports = router;
