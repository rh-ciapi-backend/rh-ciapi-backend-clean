const { MASTER_EMAIL } = require('../config/accessControl');

function requirePermission(moduleName, actionName = 'visualizar') {
  return async (req, res, next) => {
    try {
      const currentUser = req.currentUser;

      if (!currentUser) {
        return res.status(401).json({ error: 'Usuário não autenticado.' });
      }

      if ((currentUser.email || '').toLowerCase() === MASTER_EMAIL.toLowerCase() || currentUser.is_master) {
        return next();
      }

      if (currentUser.status && currentUser.status !== 'ATIVO') {
        return res.status(403).json({ error: 'Usuário sem acesso ativo.' });
      }

      const permissions = currentUser.permissions || [];
      const permission = permissions.find((item) => item.module === moduleName);

      if (!permission || !permission.allowed) {
        return res.status(403).json({ error: `Acesso negado ao módulo ${moduleName}.` });
      }

      const actions = permission.actions || [];
      if (!actions.includes(actionName)) {
        return res.status(403).json({ error: `Permissão insuficiente para ${actionName} em ${moduleName}.` });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { requirePermission };
