const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requirePermission } = require('../middleware/requirePermission');
const { createAuditLogger } = require('../middleware/auditLogger');
const adminUsersService = require('../services/adminUsersService');
const saeAgendaService = require('../services/saeAgendaService');

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

// =========================================================
// AGENDA OFICIAL - SECRETARIA / USUÁRIOS COM PERMISSÃO
// Reutiliza sae_profissionais para não criar uma nova permissão
// administrativa apenas nesta etapa.
// =========================================================

router.get(
  '/profissionais/:profissionalId',
  requirePermission('sae_profissionais', 'visualizar'),
  async (req, res, next) => {
    try {
      const response = await saeAgendaService.listOfficialAgenda(
        supabase,
        req.params.profissionalId,
      );

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/profissionais/:profissionalId',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const agenda = await saeAgendaService.createOfficialAgenda({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        profissionalId: req.params.profissionalId,
        payload: req.body,
        req,
      });

      return res.status(201).json({ ok: true, agenda });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  '/periodos/:agendaId/impacto',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const impacto = await saeAgendaService.getAgendaImpact(
        supabase,
        req.params.agendaId,
      );

      return res.json(impacto);
    } catch (error) {
      return next(error);
    }
  },
);

router.put(
  '/periodos/:agendaId',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const response = await saeAgendaService.updateOfficialAgenda({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        agendaId: req.params.agendaId,
        payload: req.body,
        req,
      });

      return res.json({ ok: true, ...response });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/periodos/:agendaId',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const response = await saeAgendaService.deleteOfficialAgenda({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        agendaId: req.params.agendaId,
        payload: req.body || {},
        req,
      });

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },
);

// =========================================================
// PROFISSIONAL - AUTOSSERVIÇO
// O profissional somente acessa a agenda vinculada ao próprio auth_user_id.
// =========================================================

router.get('/minha-agenda', async (req, res, next) => {
  try {
    const profissional = await saeAgendaService.getProfessionalByAuthUser(
      supabase,
      req.authUser.id,
    );

    if (!profissional) {
      return res.status(404).json({
        error: 'Seu usuário ainda não está vinculado a um profissional do SAE.',
      });
    }

    const response = await saeAgendaService.listOfficialAgenda(
      supabase,
      profissional.id,
      { includeInactive: false },
    );

    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.get('/minhas-solicitacoes', async (req, res, next) => {
  try {
    const response = await saeAgendaService.listMyScheduleRequests(
      supabase,
      req.authUser.id,
    );

    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.post('/solicitacoes', async (req, res, next) => {
  try {
    const solicitacao = await saeAgendaService.createScheduleRequest({
      supabase,
      authUser: req.authUser,
      actor: req.currentUser,
      auditLog,
      payload: req.body,
      req,
    });

    return res.status(201).json({ ok: true, solicitacao });
  } catch (error) {
    return next(error);
  }
});

router.patch('/solicitacoes/:id/cancelar', async (req, res, next) => {
  try {
    const solicitacao = await saeAgendaService.cancelScheduleRequest({
      supabase,
      authUser: req.authUser,
      actor: req.currentUser,
      auditLog,
      requestId: req.params.id,
      req,
    });

    return res.json({ ok: true, solicitacao });
  } catch (error) {
    return next(error);
  }
});

// =========================================================
// SECRETARIA - ANÁLISE DE SOLICITAÇÕES
// =========================================================

router.get(
  '/solicitacoes',
  requirePermission('sae_profissionais', 'visualizar'),
  async (req, res, next) => {
    try {
      const solicitacoes = await saeAgendaService.listScheduleRequests(
        supabase,
        {
          status: req.query.status,
          profissionalId: req.query.profissionalId,
        },
      );

      return res.json({ solicitacoes });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/solicitacoes/:id/analisar',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const response = await saeAgendaService.analyzeScheduleRequest({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        requestId: req.params.id,
        payload: req.body,
        req,
      });

      return res.json({ ok: true, ...response });
    } catch (error) {
      return next(error);
    }
  },
);

router.use((error, req, res, next) => {
  console.error('[saeAgendaRoutes]', error);

  return res.status(error.statusCode || 500).json({
    error: error.message || 'Erro interno no módulo de agenda do SAE.',
    details: error.details || undefined,
  });
});

module.exports = router;
