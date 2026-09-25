const express = require('express');
const adminUsersService = require('../services/adminUsersService');
const { requirePermission } = require('../middleware/requirePermission');
const { exportarFrequencia } = require('../services/frequenciaExportService');

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

    const perfisAutorizados = ['MASTER', 'ADMINISTRADOR', 'RH', 'GESTOR', 'CONSULTA'];

    if (
      (!currentUser.id && !currentUser.is_master) ||
      (!currentUser.is_master && currentUser.status !== 'ATIVO') ||
      !perfisAutorizados.includes(currentUser.perfil)
    ) {
      return res.status(403).json({ error: 'Acesso negado à frequência.' });
    }

    req.authUser = data.user;
    req.currentUser = currentUser;
    return next();
  } catch (error) {
    return next(error);
  }
}

function getHttpStatusFromMessage(message) {
  if (
    message.includes('obrigatório') ||
    message.includes('inválido') ||
    message.includes('Informe ') ||
    message.includes('categoria para exportação') ||
    message.includes('setor para exportação')
  ) {
    return 400;
  }

  if (
    message.includes('não encontrado') ||
    message.includes('Não foi possível localizar') ||
    message.includes('Nenhum servidor encontrado')
  ) {
    return 404;
  }

  if (message.includes('LibreOffice/soffice')) {
    return 503;
  }

  return 500;
}

router.post(
  '/exportar',
  autenticar,
  requirePermission('frequencia', 'exportar'),
  async (req, res) => {
    try {
      const payload = req.body || {};
      const result = await exportarFrequencia(payload);

      res.setHeader('Content-Type', result.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      );
      res.setHeader('Content-Length', result.buffer.length);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Export-Mode', result.modoExportacao || 'individual');
      res.setHeader('X-Export-Strategy', result.estrategia || 'arquivo_unico');
      res.setHeader('X-Export-Total-Files', String(result.totalArquivos || 1));
      res.setHeader('X-Export-Total-Servers', String(result.totalServidores || 1));

      return res.status(200).send(result.buffer);
    } catch (error) {
      console.error('[POST /api/frequencia/exportar] erro:', error);

      const message = error?.message || 'Erro interno ao exportar frequência';
      const status = getHttpStatusFromMessage(message);

      return res.status(status).json({
        ok: false,
        error: 'Erro ao exportar frequência',
        details: message,
      });
    }
  }
);

module.exports = router;
