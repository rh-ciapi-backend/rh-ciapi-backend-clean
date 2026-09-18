const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requirePermission } = require('../middleware/requirePermission');
const { createAuditLogger } = require('../middleware/auditLogger');
const adminUsersService = require('../services/adminUsersService');
const saeAgendamentosService = require('../services/saeAgendamentosService');

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
  '/catalogo',
  requirePermission('sae_profissionais', 'visualizar'),
  async (req, res, next) => {
    try {
      const response = await saeAgendamentosService.listarCatalogo(supabase);
      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  '/usuarios',
  requirePermission('sae_profissionais', 'visualizar'),
  async (req, res, next) => {
    try {
      const response = await saeAgendamentosService.buscarUsuarios(
        supabase,
        req.query.busca,
        req.query.limit,
      );

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  '/disponibilidade',
  requirePermission('sae_profissionais', 'visualizar'),
  async (req, res, next) => {
    try {
      const response = await saeAgendamentosService.consultarDisponibilidade(
        supabase,
        {
          profissionalId: req.query.profissionalId,
          servicoId: req.query.servicoId,
          data: req.query.data,
        },
      );

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },
);



router.get(
  '/disponibilidade-periodo',
  requirePermission('sae_profissionais', 'visualizar'),
  async (req, res, next) => {
    try {
      const response =
        await saeAgendamentosService.consultarDisponibilidadePeriodo(
          supabase,
          {
            profissionalId: req.query.profissionalId,
            servicoId: req.query.servicoId,
            inicio: req.query.inicio,
            fim: req.query.fim,
          },
        );

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  },
);

router.get('/minha-agenda', async (req, res, next) => {
  try {
    const response = await saeAgendamentosService.listarMeusAgendamentos(
      supabase,
      req.authUser.id,
    );

    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  '/:id/cancelar',
  requirePermission('sae_profissionais', 'editar'),
  async (req, res, next) => {
    try {
      const agendamento = await saeAgendamentosService.cancelarAgendamento({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        agendamentoId: req.params.id,
        payload: req.body || {},
        req,
      });

      return res.json({ ok: true, agendamento });
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
      const response = await saeAgendamentosService.criarAgendamento({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        auditLog,
        payload: req.body,
        req,
      });

      return res.status(201).json({ ok: true, agendamento: response });
    } catch (error) {
      return next(error);
    }
  },
);

router.use((error, req, res, next) => {
  console.error('[saeAgendamentosRoutes]', error);

  return res.status(error.statusCode || 500).json({
    error: error.message || 'Erro interno no módulo de agendamentos do SAE.',
    details: error.details || undefined,
  });
});

module.exports = router;
