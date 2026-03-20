const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requirePermission } = require('../middleware/requirePermission');
const { createAuditLogger } = require('../middleware/auditLogger');
const adminUsersService = require('../services/adminUsersService');

const router = express.Router();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

    const currentUser = await adminUsersService.getCurrentActor(supabase, data.user);
    req.authUser = data.user;
    req.currentUser = currentUser;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.use(authenticate);

router.get('/users', requirePermission('administracao', 'visualizar'), async (req, res, next) => {
  try {
    const response = await adminUsersService.listUsers(supabase, {
      termo: req.query.termo,
      perfil: req.query.perfil,
      setorId: req.query.setorId,
      status: req.query.status,
    });
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/users/:id', requirePermission('administracao', 'visualizar'), async (req, res, next) => {
  try {
    const user = await adminUsersService.getUserById(supabase, req.params.id);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

router.post('/users', requirePermission('administracao', 'gerenciar_usuarios'), async (req, res, next) => {
  try {
    const user = await adminUsersService.createUser({
      supabase,
      authAdmin: req.authUser,
      auditLog,
      payload: req.body,
      req,
    });

    res.status(201).json({ ok: true, user });
  } catch (error) {
    next(error);
  }
});

router.put('/users/:id', requirePermission('administracao', 'gerenciar_usuarios'), async (req, res, next) => {
  try {
    const user = await adminUsersService.updateUser({
      supabase,
      authAdmin: req.authUser,
      auditLog,
      payload: req.body,
      userId: req.params.id,
      req,
    });

    res.json({ ok: true, user });
  } catch (error) {
    next(error);
  }
});

router.patch('/users/:id/status', requirePermission('administracao', 'gerenciar_usuarios'), async (req, res, next) => {
  try {
    const user = await adminUsersService.updateUserStatus({
      supabase,
      authAdmin: req.authUser,
      auditLog,
      userId: req.params.id,
      status: req.body.status,
      req,
    });

    res.json({ ok: true, user });
  } catch (error) {
    next(error);
  }
});

router.delete('/users/:id', requirePermission('administracao', 'gerenciar_usuarios'), async (req, res, next) => {
  try {
    const response = await adminUsersService.deleteUser({
      supabase,
      authAdmin: req.authUser,
      auditLog,
      userId: req.params.id,
      req,
    });

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/reset-password', requirePermission('administracao', 'gerenciar_usuarios'), async (req, res, next) => {
  try {
    const response = await adminUsersService.resetPassword({
      supabase,
      authAdmin: req.authUser,
      userId: req.params.id,
      newPassword: req.body.newPassword,
      auditLog,
      req,
    });

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/logs', requirePermission('administracao', 'visualizar'), async (req, res, next) => {
  try {
    const response = await adminUsersService.listLogs(supabase, {
      search: req.query.search,
      module: req.query.module,
      action: req.query.action,
      limit: req.query.limit,
    });

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.use((error, req, res, next) => {
  console.error('[adminRoutes]', error);
  res.status(error.statusCode || 500).json({
    error: error.message || 'Erro interno no módulo de administração.',
  });
});

module.exports = router;
