const express = require("express");
const adminUsersService = require("../services/adminUsersService");
const { requirePermission } = require("../middleware/requirePermission");

const {
  listarFrequenciaMensal,
  registrarOcorrenciaFrequencia,
  editarOcorrenciaFrequencia,
  excluirOcorrenciaFrequencia,
} = require("../services/frequenciaService");

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    const token = String(req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    if (!token) {
      return res.status(401).json({ error: "Token ausente." });
    }

    const supabase = req.app.locals.supabase;
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Token inválido." });
    }

    const currentUser = await adminUsersService.getCurrentActor(
      supabase,
      data.user
    );

    const perfisAutorizados = [
      "MASTER",
      "ADMINISTRADOR",
      "RH",
      "GESTOR",
      "CONSULTA",
    ];

    if (
      (!currentUser.id && !currentUser.is_master) ||
      (!currentUser.is_master && currentUser.status !== "ATIVO") ||
      !perfisAutorizados.includes(currentUser.perfil)
    ) {
      return res.status(403).json({ error: "Acesso negado à frequência." });
    }

    req.authUser = data.user;
    req.currentUser = currentUser;
    return next();
  } catch (error) {
    return next(error);
  }
});

router.get("/", requirePermission("frequencia", "visualizar"), async (req, res) => {
  try {
    const ano = Number(req.query.ano);
    const mes = Number(req.query.mes);

    const result = await listarFrequenciaMensal({
      supabase: req.app.locals.supabase,
      ano,
      mes,
      servidorCpf: req.query.servidorCpf || req.query.cpf || null,
      cpf: req.query.cpf || req.query.servidorCpf || null,
      categoria: req.query.categoria || null,
      setor: req.query.setor || null,
      status: req.query.status || null,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("[FREQUENCIA][GET /] erro:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/", requirePermission("frequencia", "criar"), async (req, res) => {
  try {
    const result = await registrarOcorrenciaFrequencia({
      supabase: req.app.locals.supabase,
      payload: req.body || {},
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("[FREQUENCIA][POST /] erro:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.put("/:id", requirePermission("frequencia", "editar"), async (req, res) => {
  try {
    const result = await editarOcorrenciaFrequencia({
      supabase: req.app.locals.supabase,
      id: req.params.id,
      payload: req.body || {},
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("[FREQUENCIA][PUT /:id] erro:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.delete("/:id", requirePermission("frequencia", "editar"), async (req, res) => {
  try {
    const result = await excluirOcorrenciaFrequencia({
      supabase: req.app.locals.supabase,
      id: req.params.id,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("[FREQUENCIA][DELETE /:id] erro:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

module.exports = router;
