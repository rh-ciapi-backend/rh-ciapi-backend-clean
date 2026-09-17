const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requirePermission } = require('../middleware/requirePermission');
const { createAuditLogger } = require('../middleware/auditLogger');
const adminUsersService = require('../services/adminUsersService');
const saeProfissionaisService = require('../services/saeProfissionaisService');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
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

    const currentUser = await adminUsersService.getCurrentActor(
      supabase,
      data.user,
    );

    req.authUser = data.user;
    req.currentUser = currentUser;

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
      const response = await saeProfissionaisService.listarProfissionais(
        supabase,
      );

      const permission = (req.currentUser?.permissions || []).find(
        (item) => item.module === 'sae_profissionais',
      );

      const permissions = req.currentUser?.is_master
        ? ['visualizar', 'criar', 'editar', 'excluir']
        : permission?.allowed
          ? permission.actions || []
          : [];

      return res.json({ ...response, permissions });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/',
  requirePermission('sae_profissionais', 'criar'),
  async (req, res, next) => {
    try {
      const profissional = await saeProfissionaisService.createProfissional({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        payload: req.body,
        req,
      });

      return res.status(201).json({ ok: true, profissional });
    } catch (error) {
      return next(error);
    }
  },
);

router.put(
  '/:id',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const profissional = await saeProfissionaisService.updateProfissional({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        profissionalId: req.params.id,
        payload: req.body,
        req,
      });

      return res.json({ ok: true, profissional });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  '/:id/status',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const profissional =
        await saeProfissionaisService.updateProfissionalStatus({
          supabase,
          authUser: req.authUser,
          actor: req.currentUser,
          auditLog,
          profissionalId: req.params.id,
          ativo: req.body.ativo,
          req,
        });

      return res.json({ ok: true, profissional });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:id',
  requirePermission('sae_profissionais', 'excluir'),
  async (req, res, next) => {
    try {
      const response = await saeProfissionaisService.deleteProfissional({
        supabase,
        actor: req.currentUser,
        auditLog,
        profissionalId: req.params.id,
        req,
      });

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },
);

router.use((error, req, res, next) => {
  console.error('[saeProfissionaisRoutes]', error);

  return res.status(error.statusCode || 500).json({
    error: error.message || 'Erro interno no módulo de profissionais do SAE.',
  });
});

module.exports = router;
