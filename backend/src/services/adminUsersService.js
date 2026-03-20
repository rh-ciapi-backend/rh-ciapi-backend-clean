const {
  MASTER_EMAIL,
  PROFILES,
  buildDefaultPermissions,
  normalizePermissions,
  isMasterEmail,
  assertMasterProtection,
} = require('../config/accessControl');

function buildStats(users, logs) {
  return {
    totalUsuarios: users.length,
    ativos: users.filter((item) => item.status === 'ATIVO').length,
    inativos: users.filter((item) => item.status === 'INATIVO').length,
    bloqueados: users.filter((item) => item.status === 'BLOQUEADO').length,
    masters: users.filter((item) => item.is_master).length,
    administradores: users.filter((item) => item.perfil === PROFILES.ADMINISTRADOR).length,
    logsHoje: (logs || []).length,
  };
}

function normalizeManagedUser(record, permissions = []) {
  return {
    id: record.id,
    auth_user_id: record.auth_user_id,
    nome_completo: record.nome_completo,
    email: record.email,
    perfil: record.perfil,
    status: record.status,
    setor_id: record.setor_id,
    setor_nome: record.setores?.nome || null,
    ultimo_login_em: record.ultimo_login_em,
    tentativas_login_falhas: record.tentativas_login_falhas || 0,
    bloqueado_ate: record.bloqueado_ate,
    is_master: !!record.is_master || isMasterEmail(record.email),
    created_at: record.created_at,
    updated_at: record.updated_at,
    permissions,
  };
}

async function getUsersWithPermissions(supabase, filters = {}) {
  let query = supabase
    .from('system_users')
    .select(`
      *,
      setores:setor_id (
        id,
        nome
      )
    `)
    .order('nome_completo', { ascending: true });

  if (filters.termo) {
    query = query.or(`nome_completo.ilike.%${filters.termo}%,email.ilike.%${filters.termo}%`);
  }
  if (filters.perfil) {
    query = query.eq('perfil', filters.perfil);
  }
  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.setorId) {
    query = query.eq('setor_id', filters.setorId);
  }

  const { data: users, error } = await query;
  if (error) throw error;

  const userIds = (users || []).map((item) => item.id);
  const permissionsByUser = new Map();

  if (userIds.length > 0) {
    const { data: permissions, error: permissionError } = await supabase
      .from('user_permissions')
      .select('*')
      .in('user_id', userIds);

    if (permissionError) throw permissionError;

    for (const permission of permissions || []) {
      const current = permissionsByUser.get(permission.user_id) || [];
      current.push({
        id: permission.id,
        user_id: permission.user_id,
        module: permission.module,
        actions: permission.actions || [],
        allowed: permission.allowed,
      });
      permissionsByUser.set(permission.user_id, current);
    }
  }

  return (users || []).map((user) =>
    normalizeManagedUser(
      user,
      permissionsByUser.get(user.id) || buildDefaultPermissions(user.perfil),
    ),
  );
}

async function getTodayLogsCount(supabase) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

  const { data, error } = await supabase
    .from('audit_logs')
    .select('id')
    .gte('created_at', start);

  if (error) {
    console.error('[getTodayLogsCount]', error.message);
    return [];
  }

  return data || [];
}

async function getCurrentActor(supabase, authUser) {
  const { data, error } = await supabase
    .from('system_users')
    .select('*')
    .eq('email', authUser.email)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    return {
      id: data.id,
      email: data.email,
      perfil: data.perfil,
      status: data.status,
      is_master: !!data.is_master || isMasterEmail(data.email),
      permissions: await getUserPermissions(supabase, data.id, data.perfil),
    };
  }

  return {
    id: null,
    email: authUser.email,
    perfil: isMasterEmail(authUser.email) ? PROFILES.MASTER : PROFILES.CONSULTA,
    status: 'ATIVO',
    is_master: isMasterEmail(authUser.email),
    permissions: buildDefaultPermissions(isMasterEmail(authUser.email) ? PROFILES.MASTER : PROFILES.CONSULTA),
  };
}

async function getUserPermissions(supabase, userId, profile) {
  const { data, error } = await supabase
    .from('user_permissions')
    .select('*')
    .eq('user_id', userId);

  if (error) throw error;
  return data && data.length > 0
    ? data.map((item) => ({
        id: item.id,
        user_id: item.user_id,
        module: item.module,
        actions: item.actions || [],
        allowed: item.allowed,
      }))
    : buildDefaultPermissions(profile);
}

async function upsertPermissions(supabase, userId, permissions, profile) {
  const normalized = normalizePermissions(permissions, profile);

  const { error: deleteError } = await supabase.from('user_permissions').delete().eq('user_id', userId);
  if (deleteError) throw deleteError;

  const payload = normalized.map((permission) => ({
    user_id: userId,
    module: permission.module,
    allowed: permission.allowed,
    actions: permission.actions,
  }));

  const { error } = await supabase.from('user_permissions').insert(payload);
  if (error) throw error;

  return normalized;
}

async function listUsers(supabase, filters = {}) {
  const users = await getUsersWithPermissions(supabase, filters);
  const logs = await getTodayLogsCount(supabase);
  return {
    users,
    stats: buildStats(users, logs),
  };
}

async function getUserById(supabase, userId) {
  const { data, error } = await supabase
    .from('system_users')
    .select(`
      *,
      setores:setor_id (
        id,
        nome
      )
    `)
    .eq('id', userId)
    .single();

  if (error) throw error;
  const permissions = await getUserPermissions(supabase, data.id, data.perfil);
  return normalizeManagedUser(data, permissions);
}

async function createUser({ supabase, authAdmin, auditLog, payload, req }) {
  const actor = await getCurrentActor(supabase, authAdmin);

  if (!actor.is_master && !(actor.permissions || []).some((item) => item.module === 'administracao' && item.actions.includes('gerenciar_usuarios'))) {
    const error = new Error('Você não possui permissão para criar usuários.');
    error.statusCode = 403;
    throw error;
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const isMaster = isMasterEmail(email);
  const perfil = isMaster ? PROFILES.MASTER : payload.perfil || PROFILES.CONSULTA;
  const status = isMaster ? 'ATIVO' : payload.status || 'ATIVO';

  const { data: existing, error: existingError } = await supabase
    .from('system_users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) {
    const error = new Error('Já existe um usuário cadastrado com este e-mail.');
    error.statusCode = 409;
    throw error;
  }

  const { data, error } = await supabase
    .from('system_users')
    .insert({
      auth_user_id: payload.auth_user_id || null,
      nome_completo: payload.nome_completo,
      email,
      perfil,
      status,
      setor_id: payload.setor_id || null,
      is_master: isMaster,
      tentativas_login_falhas: 0,
    })
    .select('*')
    .single();

  if (error) throw error;

  const permissions = await upsertPermissions(
    supabase,
    data.id,
    isMaster ? buildDefaultPermissions(PROFILES.MASTER) : payload.permissions,
    perfil,
  );

  await auditLog(req, {
    action: 'CREATE_USER',
    module: 'administracao',
    entityType: 'system_user',
    entityId: data.id,
    entityLabel: email,
    description: `Usuário ${email} criado por ${actor.email}.`,
    metadata: {
      perfil,
      status,
      setor_id: payload.setor_id || null,
    },
  });

  return normalizeManagedUser(data, permissions);
}

async function updateUser({ supabase, authAdmin, auditLog, payload, userId, req }) {
  const actor = await getCurrentActor(supabase, authAdmin);
  const targetUser = await getUserById(supabase, userId);

  assertMasterProtection({
    targetUser,
    actorUser: actor,
    requestedProfile: payload.perfil,
    requestedStatus: payload.status,
  });

  if (!actor.is_master && actor.id === targetUser.id && payload.perfil && payload.perfil !== targetUser.perfil) {
    const error = new Error('Você não pode alterar o próprio perfil administrativo.');
    error.statusCode = 403;
    throw error;
  }

  const nextEmail = String(payload.email || targetUser.email).trim().toLowerCase();
  const willBeMaster = isMasterEmail(nextEmail);
  const nextProfile = willBeMaster ? PROFILES.MASTER : payload.perfil || targetUser.perfil;
  const nextStatus = willBeMaster ? 'ATIVO' : payload.status || targetUser.status;

  const { data, error } = await supabase
    .from('system_users')
    .update({
      nome_completo: payload.nome_completo || targetUser.nome_completo,
      email: nextEmail,
      perfil: nextProfile,
      status: nextStatus,
      setor_id: payload.setor_id === undefined ? targetUser.setor_id : payload.setor_id || null,
      is_master: willBeMaster,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;

  const permissions = await upsertPermissions(
    supabase,
    data.id,
    willBeMaster ? buildDefaultPermissions(PROFILES.MASTER) : payload.permissions,
    nextProfile,
  );

  await auditLog(req, {
    action: 'UPDATE_USER',
    module: 'administracao',
    entityType: 'system_user',
    entityId: data.id,
    entityLabel: nextEmail,
    description: `Usuário ${nextEmail} atualizado por ${actor.email}.`,
    metadata: {
      previous_profile: targetUser.perfil,
      next_profile: nextProfile,
      previous_status: targetUser.status,
      next_status: nextStatus,
    },
  });

  return normalizeManagedUser(data, permissions);
}

async function updateUserStatus({ supabase, authAdmin, auditLog, userId, status, req }) {
  const actor = await getCurrentActor(supabase, authAdmin);
  const targetUser = await getUserById(supabase, userId);

  assertMasterProtection({
    targetUser,
    actorUser: actor,
    requestedStatus: status,
  });

  const { data, error } = await supabase
    .from('system_users')
    .update({
      status,
      bloqueado_ate: status === 'BLOQUEADO' ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;

  const permissions = await getUserPermissions(supabase, data.id, data.perfil);

  await auditLog(req, {
    action: 'UPDATE_USER_STATUS',
    module: 'administracao',
    entityType: 'system_user',
    entityId: data.id,
    entityLabel: data.email,
    description: `Status do usuário ${data.email} alterado para ${status} por ${actor.email}.`,
    metadata: { status },
  });

  return normalizeManagedUser(data, permissions);
}

async function deleteUser({ supabase, authAdmin, auditLog, userId, req }) {
  const actor = await getCurrentActor(supabase, authAdmin);
  const targetUser = await getUserById(supabase, userId);

  assertMasterProtection({
    targetUser,
    actorUser: actor,
    allowDelete: true,
  });

  const { error: deletePermissionsError } = await supabase.from('user_permissions').delete().eq('user_id', userId);
  if (deletePermissionsError) throw deletePermissionsError;

  const { error } = await supabase.from('system_users').delete().eq('id', userId);
  if (error) throw error;

  await auditLog(req, {
    action: 'DELETE_USER',
    module: 'administracao',
    entityType: 'system_user',
    entityId: targetUser.id,
    entityLabel: targetUser.email,
    description: `Usuário ${targetUser.email} excluído por ${actor.email}.`,
    metadata: {
      perfil: targetUser.perfil,
    },
  });

  return { ok: true };
}

async function resetPassword({ supabase, authAdmin, userId, newPassword, auditLog, req }) {
  const actor = await getCurrentActor(supabase, authAdmin);
  const targetUser = await getUserById(supabase, userId);

  assertMasterProtection({
    targetUser,
    actorUser: actor,
  });

  if (!newPassword || String(newPassword).length < 6) {
    const error = new Error('A nova senha deve ter pelo menos 6 caracteres.');
    error.statusCode = 400;
    throw error;
  }

  if (targetUser.auth_user_id) {
    const { error } = await supabase.auth.admin.updateUserById(targetUser.auth_user_id, {
      password: newPassword,
    });
    if (error) throw error;
  }

  await auditLog(req, {
    action: 'RESET_PASSWORD',
    module: 'administracao',
    entityType: 'system_user',
    entityId: targetUser.id,
    entityLabel: targetUser.email,
    description: `Senha redefinida para ${targetUser.email} por ${actor.email}.`,
    metadata: {},
  });

  return { ok: true };
}

async function listLogs(supabase, filters = {}) {
  let query = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters.search) {
    query = query.or(`actor_email.ilike.%${filters.search}%,description.ilike.%${filters.search}%,entity_label.ilike.%${filters.search}%`);
  }
  if (filters.module) {
    query = query.ilike('module', `%${filters.module}%`);
  }
  if (filters.action) {
    query = query.ilike('action', `%${filters.action}%`);
  }
  if (filters.limit) {
    query = query.limit(Number(filters.limit));
  } else {
    query = query.limit(100);
  }

  const { data, error } = await query;
  if (error) throw error;

  return { logs: data || [] };
}

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  deleteUser,
  resetPassword,
  listLogs,
  getCurrentActor,
};
