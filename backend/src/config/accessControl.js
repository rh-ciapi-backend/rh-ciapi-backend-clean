const MASTER_EMAIL = 'joabbys@hotmail.com';

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
  'frequencia',
  'ferias',
  'escala',
  'mapas',
  'atestados',
  'eventos',
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
    frequencia: ['visualizar', 'criar', 'editar', 'exportar'],
    ferias: ['visualizar', 'criar', 'editar', 'exportar', 'aprovar'],
    escala: ['visualizar', 'editar'],
    mapas: ['visualizar', 'exportar'],
    atestados: ['visualizar', 'criar', 'editar', 'aprovar'],
    eventos: ['visualizar'],
    administracao: ['visualizar'],
    relatorios: ['visualizar', 'exportar'],
    exportacoes: ['visualizar', 'exportar'],
  },
  GESTOR: {
    dashboard: ['visualizar'],
    servidores: ['visualizar'],
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
    dashboard: ['visualizar'],
    servidores: [],
    frequencia: ['visualizar'],
    ferias: ['visualizar'],
    escala: ['visualizar'],
    mapas: [],
    atestados: ['visualizar'],
    eventos: ['visualizar'],
    administracao: [],
    relatorios: [],
    exportacoes: [],
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

    return {
      module: moduleName,
      allowed: Boolean(current.allowed || allowedActions.length > 0),
      actions: allowedActions,
    };
  });
}

function isMasterEmail(email = '') {
  return String(email).trim().toLowerCase() === MASTER_EMAIL.toLowerCase();
}

function assertMasterProtection({
  targetUser,
  actorUser,
  requestedProfile,
  requestedStatus,
  allowDelete = false,
}) {
  if (!targetUser?.is_master) return;

  if (!actorUser?.is_master) {
    if (allowDelete) {
      const error = new Error('O usuário master não pode ser excluído por administradores comuns.');
      error.statusCode = 403;
      throw error;
    }

    if (requestedProfile && requestedProfile !== PROFILES.MASTER) {
      const error = new Error('Não é permitido reduzir o perfil do usuário master.');
      error.statusCode = 403;
      throw error;
    }

    if (requestedStatus && requestedStatus !== 'ATIVO') {
      const error = new Error('Não é permitido inativar ou bloquear o usuário master.');
      error.statusCode = 403;
      throw error;
    }
  }
}

module.exports = {
  MASTER_EMAIL,
  PROFILES,
  PERMISSION_MODULES,
  PERMISSION_ACTIONS,
  buildDefaultPermissions,
  normalizePermissions,
  isMasterEmail,
  assertMasterProtection,
};
