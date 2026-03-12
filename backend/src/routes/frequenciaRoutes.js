const express = require("express");
const router = express.Router();

const {
  listarFrequenciaMensal,
  registrarOcorrenciaFrequencia,
  editarOcorrenciaFrequencia,
  excluirOcorrenciaFrequencia,
} = require("../services/frequenciaService");

router.get("/", async (req, res) => {
  try {
    const ano = Number(req.query.ano);
    const mes = Number(req.query.mes);
    const servidorCpf = req.query.servidorCpf || req.query.cpf || null;

    const data = await listarFrequenciaMensal({
      supabase: req.app.locals.supabase,
      ano,
      mes,
      servidorCpf,
    });

    return res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("[FREQUENCIA][GET /] erro:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const result = await registrarOcorrenciaFrequencia({
      supabase: req.app.locals.supabase,
      payload: req.body || {},
    });

    return res.status(200).json({
      ok: true,
      data: result,
    });
  } catch (error) {
    console.error("[FREQUENCIA][POST /] erro:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const result = await editarOcorrenciaFrequencia({
      supabase: req.app.locals.supabase,
      id: req.params.id,
      payload: req.body || {},
    });

    return res.status(200).json({
      ok: true,
      data: result,
    });
  } catch (error) {
    console.error("[FREQUENCIA][PUT /:id] erro:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await excluirOcorrenciaFrequencia({
      supabase: req.app.locals.supabase,
      id: req.params.id,
    });

    return res.status(200).json({
      ok: true,
      data: result,
    });
  } catch (error) {
    console.error("[FREQUENCIA][DELETE /:id] erro:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

module.exports = router;
