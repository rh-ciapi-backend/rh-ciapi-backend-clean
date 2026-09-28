const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requirePermission } = require('../middleware/requirePermission');
const { createAuditLogger } = require('../middleware/auditLogger');
const adminUsersService = require('../services/adminUsersService');
const saeTriagemService = require('../services/saeTriagemService');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

const auditLog = createAuditLogger(supabase);

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      return res.status(401).json({ error: 'Token ausente.' });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: 'Token inválido.' });
    }

    req.authUser = data.user;
    req.currentUser = await adminUsersService.getCurrentActor(
      supabase,
      data.user,
    );

    return next();
  } catch (error) {
    return next(error);
  }
}

router.use(authenticate);

router.get(
  '/',
  requirePermission('sae_profissionais', 'visualizar'),
  async (req, res, next) => {
    try {
      const response = await saeTriagemService.listar(supabase, {
        busca: req.query.busca,
        status: req.query.status,
        etapa: req.query.etapa,
      });

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  '/:id',
  requirePermission('sae_profissionais', 'visualizar'),
  async (req, res, next) => {
    try {
      const triagem = await saeTriagemService.obter(
        supabase,
        req.params.id,
      );

      return res.json({ triagem });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const triagem = await saeTriagemService.criar({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        payload: req.body || {},
        req,
      });

      return res.status(201).json({
        ok: true,
        triagem,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  '/:id/etapas/:etapa',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const triagem = await saeTriagemService.atualizarEtapa({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        triagemId: req.params.id,
        etapa: req.params.etapa,
        payload: req.body || {},
        req,
      });

      return res.json({
        ok: true,
        triagem,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  '/:id/decisao',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const triagem = await saeTriagemService.decidir({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        triagemId: req.params.id,
        payload: req.body || {},
        req,
      });

      return res.json({
        ok: true,
        triagem,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.use((error, req, res, next) => {
  console.error('[saeTriagemRoutes]', error);

  return res.status(error.statusCode || 500).json({
    error:
      error.message ||
      'Erro interno no módulo de triagem do SAE.',
    details: error.details || undefined,
  });
});

module.exports = router;
