const adminUsersService = require('../services/adminUsersService');
const {
  canAccessEnvironment,
  PROFILES,
} = require('../config/accessControl');

function requireEnvironment(supabase, environment) {
  return async (req, res, next) => {
    try {
      const token = String(req.headers.authorization || '')
        .replace(/^Bearer\s+/i, '')
        .trim();

      if (!token) {
        return res.status(401).json({ error: 'Token ausente.' });
      }

      if (!req.authUser) {
        const { data, error } = await supabase.auth.getUser(token);

        if (error || !data?.user) {
          return res.status(401).json({ error: 'Token inválido.' });
        }

        req.authUser = data.user;
        req.currentUser = await adminUsersService.getCurrentActor(
          supabase,
          data.user
        );
      }

      if (
        req.currentUser.perfil === PROFILES.SERVIDOR_LIMITADO ||
        !canAccessEnvironment(req.currentUser, environment)
      ) {
        return res.status(403).json({
          error: 'Acesso negado a este ambiente.',
        });
      }

      req.accessEnvironment = environment;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { requireEnvironment };
