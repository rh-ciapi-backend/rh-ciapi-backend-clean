const express = require('express');
const adminUsersService = require('../services/adminUsersService');
const { requirePermission } = require('../middleware/requirePermission');
const { getMapaPreview } = require('../services/mapasService');

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
      return res.status(403).json({ error: 'Acesso negado aos mapas.' });
    }

    req.authUser = data.user;
    req.currentUser = currentUser;
    return next();
  } catch (error) {
    return next(error);
  }
}

function normalizeFilters(source = {}) {
  return {
    mes: Number(source.mes) || new Date().getMonth() + 1,
    ano: Number(source.ano) || new Date().getFullYear(),
    categoria: String(source.categoria || '').trim(),
    setor: String(source.setor || '').trim(),
    status: String(source.status || 'ATIVO').trim().toUpperCase(),
    layout: String(source.layout || 'automatico').trim(),
    modoExportacao: String(source.modoExportacao || 'arquivo_unico').trim(),
  };
}

router.get(
  '/preview',
  autenticar,
  requirePermission('mapas', 'visualizar'),
  async (req, res) => {
    try {
      const filters = normalizeFilters(req.query || {});
      const payload = await getMapaPreview(filters);
      return res.json(payload);
    } catch (error) {
      console.error('[mapas/preview]', error);
      return res.status(500).json({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Erro ao montar preview do mapa.',
      });
    }
  }
);

router.post(
  '/validar',
  autenticar,
  requirePermission('mapas', 'visualizar'),
  async (req, res) => {
    try {
      const filters = normalizeFilters(req.body || {});
      const payload = await getMapaPreview(filters);
      return res.json(payload);
    } catch (error) {
      console.error('[mapas/validar]', error);
      return res.status(500).json({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Erro ao validar dados do mapa.',
      });
    }
  }
);

module.exports = router;
