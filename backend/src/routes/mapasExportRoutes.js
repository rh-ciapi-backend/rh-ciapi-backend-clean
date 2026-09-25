const express = require('express');
const fs = require('fs');
const adminUsersService = require('../services/adminUsersService');
const { requirePermission } = require('../middleware/requirePermission');
const {
  exportMapaDocx,
  exportMapaPdf,
  exportMapaZip,
} = require('../services/mapasExportService');

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
      return res.status(403).json({ error: 'Acesso negado à exportação de mapas.' });
    }

    req.authUser = data.user;
    req.currentUser = currentUser;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.use(autenticar, requirePermission('mapas', 'exportar'));

router.post('/exportar/docx', async (req, res) => {
  try {
    const result = await exportMapaDocx(req.body || {});
    res.download(result.filePath, result.fileName, () => {
      try { fs.unlinkSync(result.filePath); } catch {}
    });
  } catch (error) {
    console.error('[mapas/exportar/docx]', error);
    res.status(500).send(error.message || 'Erro ao exportar DOCX do mapa.');
  }
});

router.post('/exportar/pdf', async (req, res) => {
  try {
    const result = await exportMapaPdf(req.body || {});
    res.download(result.filePath, result.fileName, () => {
      try { fs.unlinkSync(result.filePath); } catch {}
    });
  } catch (error) {
    console.error('[mapas/exportar/pdf]', error);
    res.status(500).send(error.message || 'Erro ao exportar PDF do mapa.');
  }
});

router.post('/exportar/zip', async (req, res) => {
  try {
    const result = await exportMapaZip(req.body || {});
    res.download(result.filePath, result.fileName, () => {
      try { fs.unlinkSync(result.filePath); } catch {}
    });
  } catch (error) {
    console.error('[mapas/exportar/zip]', error);
    res.status(500).send(error.message || 'Erro ao exportar ZIP do mapa.');
  }
});

module.exports = router;
