const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const adminUsersService = require('../services/adminUsersService');
const saeMapasProfissionalService = require('../services/saeMapasProfissionalService');

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

router.get('/', async (req, res, next) => {
  try {
    return res.json(
      await saeMapasProfissionalService.listar({
        supabase,
        authUser: req.authUser,
        mes: req.query.mes,
        ano: req.query.ano,
        servicoId: req.query.servicoId,
      }),
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/docx', async (req, res, next) => {
  try {
    const result = await saeMapasProfissionalService.gerarDocx({
      supabase,
      authUser: req.authUser,
      mes: req.query.mes,
      ano: req.query.ano,
      servicoId: req.query.servicoId,
    });

    if (result.truncated) {
      res.setHeader('X-CIAPI-Mapa-Truncado', 'true');
      res.setHeader('X-CIAPI-Mapa-Total', String(result.total));
    }

    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.attachment(result.filename);
    return res.send(result.buffer);
  } catch (error) {
    return next(error);
  }
});

router.use((error, req, res, next) => {
  console.error('[saeMapasProfissionalRoutes]', error);
  return res.status(error.statusCode || 500).json({
    error: error.message || 'Erro interno no mapa mensal do profissional.',
  });
});

module.exports = router;
