const express = require("express");
const {
  listarEventos,
  obterEventoPorId,
  criarEvento,
  atualizarEvento,
  excluirEvento,
  listarTiposEvento,
} = require("../services/eventosService");

const router = express.Router();

router.get("/tipos", async (_req, res) => {
  try {
    const data = listarTiposEvento();
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const ano = Number(req.query.ano);
    const mes = Number(req.query.mes);
    const tipo = typeof req.query.tipo === "string" ? req.query.tipo : undefined;
    const ativo =
      req.query.ativo === undefined
        ? undefined
        : String(req.query.ativo).toLowerCase() === "true";

    const data = await listarEventos(req.app.locals.supabase, {
      ano,
      mes,
      tipo,
      ativo,
    });

    return res.status(200).json({
      ok: true,
      data,
      meta: {
        ano: Number.isFinite(ano) ? ano : undefined,
        mes: Number.isFinite(mes) ? mes : undefined,
        total: Array.isArray(data) ? data.length : 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /obrigat|inválid|invalido|inválido/i.test(message) ? 400 : 500;

    return res.status(status).json({
      ok: false,
      error: message,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const data = await obterEventoPorId(req.app.locals.supabase, req.params.id);

    return res.status(200).json({
      ok: true,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /não encontrado|nao encontrado/i.test(message) ? 404 : 500;

    return res.status(status).json({
      ok: false,
      error: message,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const data = await criarEvento(req.app.locals.supabase, req.body || {});

    return res.status(201).json({
      ok: true,
      data,
      message: "Evento cadastrado com sucesso.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /obrigat|inválid|invalido|inválido|já existe|ja existe/i.test(message)
      ? 400
      : 500;

    return res.status(status).json({
      ok: false,
      error: message,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const data = await atualizarEvento(req.app.locals.supabase, req.params.id, req.body || {});

    return res.status(200).json({
      ok: true,
      data,
      message: "Evento atualizado com sucesso.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /não encontrado|nao encontrado/i.test(message)
      ? 404
      : /obrigat|inválid|invalido|inválido|já existe|ja existe/i.test(message)
      ? 400
      : 500;

    return res.status(status).json({
      ok: false,
      error: message,
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const data = await excluirEvento(req.app.locals.supabase, req.params.id);

    return res.status(200).json({
      ok: true,
      data,
      message: "Evento excluído com sucesso.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /não encontrado|nao encontrado/i.test(message) ? 404 : 500;

    return res.status(status).json({
      ok: false,
      error: message,
    });
  }
});

module.exports = router;
