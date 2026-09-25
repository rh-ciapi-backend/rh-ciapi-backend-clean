const express = require('express');
const adminUsersService = require('../services/adminUsersService');
const { requirePermission } = require('../middleware/requirePermission');
const { exportarFerias } = require('../services/feriasExportService');

const router = express.Router();

async function autenticar(req, res, next) {
  try {
    const token = String(req.headers.authorization || '')
      .replace(/^Bearer\s+/i, '')
      .trim();

    if (!token) {
      return res.status(401).json({ error: 'Token ausente.' });
    }

    const supabase = req.app.locals.supabase;
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: 'Token inválido.' });
    }

    const currentUser = await adminUsersService.getCurrentActor(
      supabase,
      data.user
    );

    const perfisAutorizados = [
      'MASTER',
      'ADMINISTRADOR',
      'RH',
      'GESTOR',
      'CONSULTA',
    ];

    if (
      (!currentUser.id && !currentUser.is_master) ||
      (!currentUser.is_master && currentUser.status !== 'ATIVO') ||
      !perfisAutorizados.includes(currentUser.perfil)
    ) {
      return res.status(403).json({ error: 'Acesso negado às férias.' });
    }

    req.authUser = data.user;
    req.currentUser = currentUser;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.post(
  '/exportar',
  autenticar,
  requirePermission('ferias', 'exportar'),
  async (req, res) => {
    try {
      return await exportarFerias(req, res);
    } catch (error) {
      console.error('[feriasExportRoutes] erro ao exportar férias:', error);

      if (res.headersSent) {
        return;
      }

      return res.status(500).json({
        ok: false,
        error: 'Erro interno ao exportar férias',
        details: error?.message || String(error),
      });
    }
  }
);

module.exports = router;
