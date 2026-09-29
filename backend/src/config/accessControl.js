const MASTER_EMAIL = 'joabbys@hotmail.com';
const GLOBAL_MASTER_EMAILS = ['joabbys@hotmail.com', 'redeciapi@gmail.com'];

const PROFILES = {
  MASTER: 'MASTER',
  ADMINISTRADOR: 'ADMINISTRADOR',
  RH: 'RH',
  GESTOR: 'GESTOR',
  CONSULTA: 'CONSULTA',
  SERVIDOR_LIMITADO: 'SERVIDOR_LIMITADO',
};

const PERMISSION_MODULES = [
  'dashboard',
  'servidores',
  'requerimentos',
  'frequencia',
  'ferias',
  'escala',
  'mapas',
  'atestados',
  'eventos',
  'sae_profissionais',
  'administracao',
  'relatorios',
  'exportacoes',
];

const PERMISSION_ACTIONS = [
  'visualizar',
  'criar',
  'editar',
  'excluir',
  'exportar',
  'aprovar',
  'gerenciar_usuarios',
];

const defaultPermissionsByProfile = {
  MASTER: Object.fromEntries(
    PERMISSION_MODULES.map((moduleName) => [
      moduleName,
      ['visualizar', 'criar', 'editar', 'excluir', 'exportar', 'aprovar', 'gerenciar_usuarios'],
    ]),
  ),
  ADMINISTRADOR: {
    dashboard: ['visualizar'],
    servidores: ['visualizar', 'criar', 'editar', 'exportar'],
    requerimentos: ['visualizar', 'criar', 'editar', 'exportar', 'aprovar'],
    frequencia: ['visualizar', 'criar', 'editar', 'exportar', 'aprovar'],
    ferias: ['visualizar', 'criar', 'editar', 'exportar', 'aprovar'],
    escala: ['visualizar', 'criar', 'editar', 'exportar'],
    mapas: ['visualizar', 'criar', 'editar', 'exportar'],
    atestados: ['visualizar', 'criar', 'editar', 'aprovar'],
    eventos: ['visualizar', 'criar', 'editar'],
    administracao: ['visualizar', 'editar', 'gerenciar_usuarios'],
    relatorios: ['visualizar', 'exportar'],
    exportacoes: ['visualizar', 'exportar'],
  },
  RH: {
    dashboard: ['visualizar'],
    servidores: ['visualizar', 'criar', 'editar', 'exportar'],
    requerimentos: ['visualizar', 'criar', 'editar', 'exportar', 'aprovar'],
    frequencia: ['visualizar', 'criar', 'editar', 'exportar'],
    ferias: ['visualizar', 'criar', 'editar', 'exportar', 'aprovar'],
    escala: ['visualizar', 'editar'],
    mapas: ['visualizar', 'exportar'],
    atestados: ['visualizar', 'criar', 'editar', 'aprovar'],
    eventos: ['visualizar', 'criar', 'editar'],
    administracao: ['visualizar'],
    relatorios: ['visualizar', 'exportar'],
    exportacoes: ['visualizar', 'exportar'],
  },
  GESTOR: {
    dashboard: ['visualizar'],
    servidores: ['visualizar'],
    requerimentos: ['visualizar', 'aprovar'],
    frequencia: ['visualizar', 'aprovar'],
    ferias: ['visualizar', 'aprovar'],
    escala: ['visualizar', 'editar'],
    mapas: ['visualizar'],
    atestados: ['visualizar', 'aprovar'],
    eventos: ['visualizar'],
    administracao: [],
    relatorios: ['visualizar'],
    exportacoes: ['visualizar', 'exportar'],
  },
  CONSULTA: {
    dashboard: ['visualizar'],
    servidores: ['visualizar'],
    frequencia: ['visualizar'],
    ferias: ['visualizar'],
    escala: ['visualizar'],
    mapas: ['visualizar'],
    atestados: ['visualizar'],
    eventos: ['visualizar'],
    administracao: [],
    relatorios: ['visualizar'],
    exportacoes: [],
  },
  SERVIDOR_LIMITADO: {
    requerimentos: ['visualizar', 'criar'],
  },
};

function buildDefaultPermissions(profile) {
  const safeProfile = profile && defaultPermissionsByProfile[profile] ? profile : PROFILES.CONSULTA;

  return PERMISSION_MODULES.map((moduleName) => {
    const actions = defaultPermissionsByProfile[safeProfile][moduleName] || [];
    return {
      module: moduleName,
      allowed: actions.length > 0,
      actions,
    };
  });
}

function normalizePermissions(permissions = [], profile = PROFILES.CONSULTA) {
  const defaultMap = new Map(buildDefaultPermissions(profile).map((item) => [item.module, item]));
  const incomingMap = new Map((permissions || []).map((item) => [item.module, item]));

  return PERMISSION_MODULES.map((moduleName) => {
    const base = defaultMap.get(moduleName);
    const current = incomingMap.get(moduleName) || base || { module: moduleName, actions: [], allowed: false };
    const allowedActions = Array.from(
      new Set((current.actions || []).filter((action) => PERMISSION_ACTIONS.includes(action))),
    );

    if (profile === PROFILES.SERVIDOR_LIMITADO) {
      const actions = moduleName === 'requerimentos'
        ? allowedActions.filter((action) => ['visualizar', 'criar'].includes(action))
        : [];
      return { module: moduleName, allowed: actions.length > 0, actions };
    }

    return {
      module: moduleName,
      allowed: Boolean(current.allowed || allowedActions.length > 0),
      actions: allowedActions,
    };
  });
}

function isMasterEmail(email = '') {
  return GLOBAL_MASTER_EMAILS.includes(String(email).trim().toLowerCase());
}

function accessError(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function allowedEnvironments(user) {
  if (!user || user.status !== 'ATIVO') return [];
  if (user.is_master && isMasterEmail(user.email)) return ['RH', 'SAE'];
  if (!user.id || user.perfil === PROFILES.SERVIDOR_LIMITADO) return [];
  return ['RH', 'SAE'].includes(user.ambiente) ? [user.ambiente] : [];
}

function canAccessEnvironment(user, environment) {
  return allowedEnvironments(user).includes(String(environment).toUpperCase());
}

function assertManagedUserAccess(actor, target) {
  if (!actor || actor.status !== 'ATIVO') throw accessError('Usuário sem acesso ativo.');
  if (actor.is_master && isMasterEmail(actor.email)) return;
  if (isMasterEmail(target.email) || !canAccessEnvironment(actor, target.ambiente)) {
    throw accessError('Você pode gerenciar apenas usuários do seu ambiente.');
  }
}

function assertMasterProtection({ targetUser, actorUser, requestedProfile, requestedStatus, allowDelete = false }) {
  if (!isMasterEmail(targetUser?.email)) return;
  if (!actorUser?.is_master || !isMasterEmail(actorUser.email)) {
    throw accessError('Conta global protegida. Acesso reservado aos administradores globais.');
  }
  if (allowDelete || (requestedProfile && requestedProfile !== PROFILES.MASTER)) {
    throw accessError('Uma conta global não pode ser excluída ou ter seu perfil reduzido.');
  }
}

module.exports = {
  MASTER_EMAIL, GLOBAL_MASTER_EMAILS, PROFILES, PERMISSION_MODULES, PERMISSION_ACTIONS,
  buildDefaultPermissions, normalizePermissions, isMasterEmail, assertMasterProtection,
  allowedEnvironments, canAccessEnvironment, assertManagedUserAccess, accessError,
};
