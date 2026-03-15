const express = require('express');
const {
  listarFrequenciaMensal,
  criarOcorrencia,
  editarOcorrencia,
  excluirOcorrencia,
} = require('../services/frequenciaService');

const router = express.Router();

/**
 * GET /api/frequencia?ano=2026&mes=3
 * Compatível com o frontend atual.
 */
router.get('/', async (req, res) => {
  try {
    const result = await listarFrequenciaMensal(req.query);
    return res.json(result);
  } catch (error) {
    console.error('[GET /api/frequencia] erro:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao consolidar frequência mensal',
      details: error.message,
    });
  }
});

/**
 * POST /api/frequencia/ocorrencias
 * Body:
 * {
 *   servidor_cpf,
 *   data,
 *   tipo,
 *   turno,
 *   observacao
 * }
 */
router.post('/ocorrencias', async (req, res) => {
  try {
    const result = await criarOcorrencia(req.body);
    return res.status(201).json(result);
  } catch (error) {
    console.error('[POST /api/frequencia/ocorrencias] erro:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao criar ocorrência de frequência',
      details: error.message,
    });
  }
});

/**
 * PUT /api/frequencia/ocorrencias/:id
 */
router.put('/ocorrencias/:id', async (req, res) => {
  try {
    const result = await editarOcorrencia(req.params.id, req.body);
    return res.json(result);
  } catch (error) {
    console.error('[PUT /api/frequencia/ocorrencias/:id] erro:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao editar ocorrência de frequência',
      details: error.message,
    });
  }
});

/**
 * DELETE /api/frequencia/ocorrencias/:id
 */
router.delete('/ocorrencias/:id', async (req, res) => {
  try {
    const result = await excluirOcorrencia(req.params.id);
    return res.json(result);
  } catch (error) {
    console.error('[DELETE /api/frequencia/ocorrencias/:id] erro:', error);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao excluir ocorrência de frequência',
      details: error.message,
    });
  }
});

module.exports = router;
