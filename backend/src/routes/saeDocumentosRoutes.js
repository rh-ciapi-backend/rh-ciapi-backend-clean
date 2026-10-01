const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const adminUsersService = require('../services/adminUsersService');
const saeDocumentosService = require('../services/saeDocumentosService');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) return res.status(401).json({ error: 'Token ausente.' });

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: 'Token inválido.' });
    }

    req.authUser = data.user;
    req.currentUser = await adminUsersService.getCurrentActor(supabase, data.user);

    if (req.currentUser.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Usuário sem acesso ativo.' });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

router.use(authenticate);

router.get('/contexto', async (req, res, next) => {
  try {
    return res.json(
      await saeDocumentosService.contexto({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
      }),
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/usuarios/buscar', async (req, res, next) => {
  try {
    return res.json(
      await saeDocumentosService.buscarUsuarios({
        supabase,
        termo: req.query.termo,
        limit: req.query.limit,
      }),
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/usuario/:usuarioId', async (req, res, next) => {
  try {
    return res.json(
      await saeDocumentosService.listarPorUsuario({
        supabase,
        usuarioId: req.params.usuarioId,
      }),
    );
  } catch (error) {
    return next(error);
  }
});

router.post('/usuario/:usuarioId', async (req, res, next) => {
  try {
    const response = await saeDocumentosService.criar({
      supabase,
      authUser: req.authUser,
      actor: req.currentUser,
      usuarioId: req.params.usuarioId,
      payload: req.body,
    });

    return res.status(201).json(response);
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    return res.json(
      await saeDocumentosService.atualizar({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        documentoId: req.params.id,
        payload: req.body,
      }),
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/docx', async (req, res, next) => {
  try {
    const { buffer, filename } = await saeDocumentosService.gerarDocx({
      supabase,
      documentoId: req.params.id,
    });

    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.attachment(filename);
    return res.send(buffer);
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/assinado', async (req, res, next) => {
  try {
    return res.json(
      await saeDocumentosService.anexarAssinado({
        supabase,
        authUser: req.authUser,
        actor: req.currentUser,
        documentoId: req.params.id,
        payload: req.body,
      }),
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/assinado', async (req, res, next) => {
  try {
    return res.json(
      await saeDocumentosService.obterUrlAssinado({
        supabase,
        documentoId: req.params.id,
      }),
    );
  } catch (error) {
    return next(error);
  }
});

router.use((error, req, res, next) => {
  console.error('[saeDocumentosRoutes]', error);
  return res.status(error.statusCode || 500).json({
    error: error.message || 'Erro interno no módulo de documentos do SAE.',
  });
});

module.exports = router;
