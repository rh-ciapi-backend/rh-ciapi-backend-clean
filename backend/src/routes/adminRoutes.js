const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requirePermission } = require('../middleware/requirePermission');
const { createAuditLogger } = require('../middleware/auditLogger');
const adminUsersService = require('../services/adminUsersService');
const requerimentosService = require('../services/requerimentosService');
const portalAcessoService = require('../services/portalAcessoService');
const { gerarRequerimentoDocx, gerarRequerimentoPdf } = require('../services/requerimentosDocxService');

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

// Login público apenas com link individual, CPF e senha inicial.
router.post('/portal/entrar', async (req, res, next) => {
  try {
    const session = await portalAcessoService.entrar(
      supabase, req.body?.cpf, req.body?.senha, req.body?.acesso, req.ip,
    );
    res.set('Cache-Control', 'no-store');
    res.json({ session });
  } catch (error) {
    next(error);
  }
});

router.use(authenticate);

router.get('/me', (req, res) => {
  const { id, perfil, status, is_master: isMaster } = req.currentUser;
  res.json({ user: { id, perfil, status, is_master: isMaster } });
});

router.post('/requerimentos/acesso', async (req, res, next) => {
  try {
    if (!req.currentUser.is_master &&
      !['ADMINISTRADOR', 'RH'].includes(req.currentUser.perfil)) {
      return res.status(403).json({ error: 'Acesso reservado à administração.' });
    }
    if (req.currentUser.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Usuário sem acesso ativo.' });
    }
    const acesso = await portalAcessoService.criarAcesso(supabase, req.body?.servidorId);
    res.set('Cache-Control', 'no-store');
    return res.json(acesso);
  } catch (error) {
    return next(error);
  }
});

function acessoRequerimentos(acao) {
  return (req, res, next) => {
    const usuario = req.currentUser;

    if (!usuario || (!usuario.id && !usuario.is_master)) {
      return res.status(403).json({ error: 'Usuário sem cadastro ativo no sistema.' });
    }
    if (!usuario.is_master && usuario.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Usuário sem acesso ativo.' });
    }
    if (usuario.is_master) return next();

    const perfis = acao === 'criar'
      ? ['ADMINISTRADOR', 'RH', 'SERVIDOR_LIMITADO']
      : ['ADMINISTRADOR', 'RH', 'GESTOR', 'CONSULTA', 'SERVIDOR_LIMITADO'];

    if (!perfis.includes(usuario.perfil)) {
      return res.status(403).json({ error: 'Acesso negado aos requerimentos.' });
    }
    return next();
  };
}

router.get('/requerimentos', acessoRequerimentos('visualizar'), async (req, res, next) => {
  try {
    const requerimentos = await requerimentosService.listar({
      supabase,
      authUser: req.authUser,
      currentUser: req.currentUser,
    });
    res.json({ requerimentos });
  } catch (error) {
    next(error);
  }
});

router.get('/requerimentos/formulario', acessoRequerimentos('visualizar'), async (req, res, next) => {
  try {
    const formulario = await requerimentosService.obterFormulario({
      supabase,
      authUser: req.authUser,
      currentUser: req.currentUser,
      servidorId: req.query.servidorId,
    });
    res.json(formulario);
  } catch (error) {
    next(error);
  }
});

router.post('/requerimentos', acessoRequerimentos('criar'), async (req, res, next) => {
  try {
    const requerimento = await requerimentosService.criar({
      supabase,
      authUser: req.authUser,
      currentUser: req.currentUser,
      payload: req.body,
    });
    res.status(201).json({ requerimento });
  } catch (error) {
    next(error);
  }
});

router.get('/requerimentos/:id/docx', acessoRequerimentos('visualizar'), async (req, res, next) => {
  try {
    const requerimento = await requerimentosService.obterParaExportacao({
      supabase, authUser: req.authUser, currentUser: req.currentUser,
      requerimentoId: req.params.id,
    });
    const arquivo = gerarRequerimentoDocx(requerimento);
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.attachment(`requerimento_${requerimento.id}.docx`);
    res.send(arquivo);
  } catch (error) {
    next(error);
  }
});

router.get('/requerimentos/:id/pdf', acessoRequerimentos('visualizar'), async (req, res, next) => {
  try {
    const requerimento = await requerimentosService.obterParaExportacao({
      supabase, authUser: req.authUser, currentUser: req.currentUser,
      requerimentoId: req.params.id,
    });
    const arquivo = await gerarRequerimentoPdf(requerimento);
    res.type('application/pdf');
    res.attachment(`requerimento_${requerimento.id}.pdf`);
    res.send(arquivo);
  } catch (error) {
    next(error);
  }
});

router.get('/users', requirePermission('administracao', 'visualizar'), async (req, res, next) => {
  try {
    const response = await adminUsersService.listUsers(supabase, {
      termo: req.query.termo,
      perfil: req.query.perfil,
      setorNome: req.query.setorNome,
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

router.patch(
  '/users/:id/status',
  requirePermission('administracao', 'gerenciar_usuarios'),
  async (req, res, next) => {
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
  },
);

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

router.post(
  '/users/:id/reset-password',
  requirePermission('administracao', 'gerenciar_usuarios'),
  async (req, res, next) => {
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
  },
);

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
