const {
  PROFILES,
  buildDefaultPermissions,
  normalizePermissions,
  isMasterEmail,
  assertMasterProtection,
  allowedEnvironments, canAccessEnvironment, assertManagedUserAccess, accessError,
} = require('../config/accessControl');

function buildStats(users, logs) {
  return {
    totalUsuarios: users.length,
    ativos: users.filter((item) => item.status === 'ATIVO').length,
    inativos: users.filter((item) => item.status === 'INATIVO').length,
    bloqueados: users.filter((item) => item.status === 'BLOQUEADO').length,
    masters: users.filter((item) => item.perfil === PROFILES.MASTER).length,
    administradores: users.filter((item) => item.perfil === PROFILES.ADMINISTRADOR).length,
    logsHoje: (logs || []).length,
  };
}

function normalizeManagedUser(record, permissions = []) {
  return {
    id: record.id,
    auth_user_id: record.auth_user_id || null,
    nome_completo: record.nome_completo,
    email: record.email,
    perfil: record.perfil,
    status: record.status,
    setor_nome: record.setor_nome || null,
    ultimo_login_em: record.ultimo_login_em || null,
    tentativas_login_falhas: record.tentativas_login_falhas || 0,
    bloqueado_ate: record.bloqueado_ate || null,
    is_master: isMasterEmail(record.email),
    ambiente: record.ambiente || 'RH',
    created_at: record.created_at,
    updated_at: record.updated_at,
    permissions,
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

async function getCurrentActor(supabase, authUser) {
  if (!authUser?.id || !authUser?.email_confirmed_at) throw accessError('Login não confirmado.');
  const email = String(authUser?.email || '').trim().toLowerCase();

  // Vínculo criado pelo RH: nunca concede acesso aos módulos internos.
  const { data: acessoServidor, error: erroAcesso } = await supabase
    .from('rh_servidor_acessos').select('servidor_id')
    .eq('auth_uid', authUser.id).maybeSingle();
  if (erroAcesso) throw erroAcesso;
  if (acessoServidor) {
    return {
      id: authUser.id,
      email,
      perfil: PROFILES.SERVIDOR_LIMITADO,
      status: 'ATIVO',
      is_master: false,
      ambiente: 'RH',
      ambientes_permitidos: [],
      permissions: buildDefaultPermissions(PROFILES.SERVIDOR_LIMITADO),
    };
  }

  const { data, error } = await supabase
    .from('system_users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    if (data.auth_user_id !== authUser.id) {
      throw accessError('Conta sem vínculo válido com o login. Solicite regularização ao administrador global.');
    }
    const actor = {
      id: data.id,
      email,
      ambiente: data.ambiente || 'RH',
      perfil: data.perfil,
      status: data.status,
      is_master: isMasterEmail(email),
      permissions: data.perfil === PROFILES.MASTER ? buildDefaultPermissions(PROFILES.MASTER) : await getUserPermissions(supabase, data.id, data.perfil),
    };
    return { ...actor, ambientes_permitidos: allowedEnvironments(actor) };
  }

  return {
    id: null,
    email,
    perfil: isMasterEmail(email) ? PROFILES.MASTER : PROFILES.CONSULTA,
    status: isMasterEmail(email) ? 'ATIVO' : 'BLOQUEADO',
    ambiente: 'RH',
    ambientes_permitidos: isMasterEmail(email) ? ['RH', 'SAE'] : [],
    is_master: isMasterEmail(email),
    permissions: buildDefaultPermissions(
      isMasterEmail(email) ? PROFILES.MASTER : PROFILES.CONSULTA,
    ),
  };
}

async function getUsersWithPermissions(supabase, filters = {}, actor) {
  if (!actor) throw accessError('Usuário não autenticado.');
  let query = supabase
    .from('system_users')
    .select('*')
    .order('nome_completo', { ascending: true });

  if (!actor.is_master) {
    query = query.eq('ambiente', actor.ambiente).eq('is_master', false);
  } else if (['RH', 'SAE'].includes(filters.ambiente)) {
    query = query.eq('ambiente', filters.ambiente);
  }

  if (filters.termo) {
    query = query.or(
      `nome_completo.ilike.%${filters.termo}%,email.ilike.%${filters.termo}%,setor_nome.ilike.%${filters.termo}%`
    );
  }

  if (filters.perfil) {
    query = query.eq('perfil', filters.perfil);
  }

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  if (filters.setorNome) {
    query = query.ilike('setor_nome', `%${filters.setorNome}%`);
  }

  const { data: users, error } = await query;
  if (error) throw error;

  const result = [];
  for (const user of users || []) {
    const permissions = await getUserPermissions(supabase, user.id, user.perfil);
    result.push(normalizeManagedUser(user, permissions));
  }

  return result;
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

async function upsertPermissions(supabase, userId, permissions, profile) {
  const normalized = normalizePermissions(permissions, profile);

  const { error: deleteError } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', userId);

  if (deleteError) throw deleteError;

  const payload = normalized.map((permission) => ({
    user_id: userId,
    module: permission.module,
    allowed: permission.allowed,
    actions: permission.actions,
  }));

  if (payload.length > 0) {
    const { error } = await supabase.from('user_permissions').insert(payload);
    if (error) throw error;
  }

  return normalized;
}

async function listUsers(supabase, filters = {}, actor) {
  const users = await getUsersWithPermissions(supabase, filters, actor);
  const logs = actor?.is_master ? await getTodayLogsCount(supabase) : [];

  return {
    users,
    stats: buildStats(users, logs),
  };
}

async function getUserById(supabase, userId) {
  const { data, error } = await supabase
    .from('system_users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;

  const permissions = await getUserPermissions(supabase, data.id, data.perfil);
  return normalizeManagedUser(data, permissions);
}


async function findAuthUserByEmail(supabase, email) {
  const targetEmail = String(email || '').trim().toLowerCase();
  if (!targetEmail) return null;

  const perPage = 1000;
  let page = 1;

  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) throw error;

    const users = Array.isArray(data?.users) ? data.users : [];
    const found = users.find(
      (user) => String(user?.email || '').trim().toLowerCase() === targetEmail,
    );

    if (found) return found;
    if (users.length < perPage) break;

    page += 1;
  }

  return null;
}

async function createUser({ supabase, authAdmin, auditLog, payload, req }) {
  const actor = await getCurrentActor(supabase, authAdmin);

  if (
    !actor.is_master &&
    !(actor.permissions || []).some(
      (item) => item.module === 'administracao' && item.actions.includes('gerenciar_usuarios')
    )
  ) {
    const error = new Error('Você não possui permissão para criar usuários.');
    error.statusCode = 403;
    throw error;
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const isMaster = isMasterEmail(email);
  if (isMaster && !actor.is_master) throw accessError('Somente um administrador global pode cadastrar esta conta.');
  const ambiente = String(payload.ambiente || actor.ambiente || 'RH').toUpperCase();
  if (!['RH', 'SAE'].includes(ambiente) || !canAccessEnvironment(actor, ambiente)) {
    throw accessError('Ambiente inválido ou não autorizado.');
  }
  if (!Object.values(PROFILES).includes(payload.perfil || PROFILES.CONSULTA)) throw accessError('Perfil inválido.');
  const perfil = isMaster ? PROFILES.MASTER : payload.perfil || PROFILES.CONSULTA;
  const status = isMaster ? 'ATIVO' : payload.status || 'ATIVO';
  if (!['ATIVO', 'INATIVO', 'BLOQUEADO'].includes(status)) throw accessError('Status inválido.');
  const setor_nome = payload.setor_nome ? String(payload.setor_nome).trim() : null;
  const senhaInicial = String(payload.senha_inicial || payload.password || '').trim();

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

  let authUserId = null;
  let reusedExistingAuth = false;

  {
    if (senhaInicial.length < 6) {
      const error = new Error('Informe uma senha inicial com pelo menos 6 caracteres.');
      error.statusCode = 400;
      throw error;
    }

    const existingAuthUser = await findAuthUserByEmail(supabase, email);

    if (existingAuthUser?.id) {
      const { data: portalLink, error: portalLinkError } = await supabase
        .from('rh_servidor_acessos')
        .select('servidor_id')
        .eq('auth_uid', existingAuthUser.id)
        .maybeSingle();

      if (portalLinkError) throw portalLinkError;

      if (portalLink) {
        const error = new Error(
          'Este e-mail já está vinculado ao acesso individual do servidor. Regularize esse vínculo antes de criar uma conta administrativa com o mesmo e-mail.',
        );
        error.statusCode = 409;
        throw error;
      }

      const { error: updateAuthError } = await supabase.auth.admin.updateUserById(
        existingAuthUser.id,
        {
          password: senhaInicial,
          user_metadata: {
            ...(existingAuthUser.user_metadata || {}),
            nome_completo: payload.nome_completo || '',
            perfil,
          },
        },
      );

      if (updateAuthError) {
        const error = new Error(
          updateAuthError.message || 'Não foi possível regularizar a conta existente no Auth.',
        );
        error.statusCode = 400;
        throw error;
      }

      authUserId = existingAuthUser.id;
      reusedExistingAuth = true;
    } else {
      const { data: authCreated, error: authError } = await supabase.auth.admin.createUser({
        email,
        password: senhaInicial,
        email_confirm: true,
        user_metadata: {
          nome_completo: payload.nome_completo || '',
          perfil,
        },
      });

      if (authError) {
        const error = new Error(authError.message || 'Não foi possível criar o usuário no Auth.');
        error.statusCode = 400;
        throw error;
      }

      authUserId = authCreated?.user?.id || null;
    }
  }

  const { data, error } = await supabase
    .from('system_users')
    .insert({
      auth_user_id: authUserId,
nome_completo: payload.nome_completo,
      email,
      perfil,
      status,
      setor_nome,
      ambiente,
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
    description: reusedExistingAuth
      ? `Usuário ${email} regularizado no Auth e vinculado ao sistema por ${actor.email}.`
      : `Usuário ${email} criado por ${actor.email}.`,
    metadata: {
      perfil,
      status,
      setor_nome,
      auth_user_id: authUserId,
      auth_reutilizado: reusedExistingAuth,
    },
  });

  return normalizeManagedUser(data, permissions);
}

async function updateUser({ supabase, authAdmin, auditLog, payload, userId, req }) {
  const actor = await getCurrentActor(supabase, authAdmin);
  const targetUser = await getUserById(supabase, userId);
  assertManagedUserAccess(actor, targetUser);

  assertMasterProtection({
    targetUser,
    actorUser: actor,
    requestedProfile: payload.perfil,
    requestedStatus: payload.status,
  });

  const nextEmail = String(payload.email || targetUser.email).trim().toLowerCase();
  if (nextEmail !== String(targetUser.email).toLowerCase()) {
    throw accessError('O e-mail de login não pode ser alterado neste formulário.');
  }
  const nextEnvironment = String(payload.ambiente || targetUser.ambiente || 'RH').toUpperCase();
  if (!['RH', 'SAE'].includes(nextEnvironment) || !canAccessEnvironment(actor, nextEnvironment)) {
    throw accessError('Ambiente inválido ou não autorizado.');
  }
  if (!Object.values(PROFILES).includes(payload.perfil || targetUser.perfil)) throw accessError('Perfil inválido.');
  const willBeMaster = isMasterEmail(nextEmail);
  const nextProfile = willBeMaster ? PROFILES.MASTER : payload.perfil || targetUser.perfil;
  const nextStatus = payload.status || targetUser.status;
  if (!['ATIVO', 'INATIVO', 'BLOQUEADO'].includes(nextStatus)) throw accessError('Status inválido.');
  const nextSetorNome =
    payload.setor_nome === undefined
      ? targetUser.setor_nome
      : payload.setor_nome
        ? String(payload.setor_nome).trim()
        : null;

  const { data, error } = await supabase
    .from('system_users')
    .update({
      nome_completo: payload.nome_completo || targetUser.nome_completo,
      email: nextEmail,
      perfil: nextProfile,
      status: nextStatus,
      setor_nome: nextSetorNome,
      ambiente: nextEnvironment,
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
      previous_setor_nome: targetUser.setor_nome,
      next_setor_nome: nextSetorNome,
    },
  });

  return normalizeManagedUser(data, permissions);
}

async function updateUserStatus({ supabase, authAdmin, auditLog, userId, status, req }) {
  if (!['ATIVO', 'INATIVO', 'BLOQUEADO'].includes(status)) throw accessError('Status inválido.');
  const actor = await getCurrentActor(supabase, authAdmin);
  const targetUser = await getUserById(supabase, userId);
  assertManagedUserAccess(actor, targetUser);

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
  assertManagedUserAccess(actor, targetUser);

  assertMasterProtection({
    targetUser,
    actorUser: actor,
    allowDelete: true,
  });

  const { error: deletePermissionsError } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', userId);

  if (deletePermissionsError) throw deletePermissionsError;

  const { error } = await supabase
    .from('system_users')
    .delete()
    .eq('id', userId);

  if (error) throw error;

  if (targetUser.auth_user_id) {
    const { data: portalLink, error: portalLinkError } = await supabase
      .from('rh_servidor_acessos')
      .select('servidor_id')
      .eq('auth_uid', targetUser.auth_user_id)
      .maybeSingle();

    if (portalLinkError) throw portalLinkError;

    // Se a mesma autenticação for usada no portal individual do servidor,
    // preservamos o Auth. Caso contrário, removemos o login para não deixar
    // uma conta órfã que impeça recriação futura com o mesmo e-mail.
    if (!portalLink) {
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(
        targetUser.auth_user_id,
      );

      if (authDeleteError) {
        console.error(
          '[deleteUser] Registro administrativo removido, mas não foi possível remover o Auth:',
          authDeleteError.message,
        );
      }
    }
  }

  await auditLog(req, {
    action: 'DELETE_USER',
    module: 'administracao',
    entityType: 'system_user',
    entityId: targetUser.id,
    entityLabel: targetUser.email,
    description: `Usuário ${targetUser.email} excluído por ${actor.email}.`,
    metadata: {
      perfil: targetUser.perfil,
      setor_nome: targetUser.setor_nome,
    },
  });

  return { ok: true };
}

async function resetPassword({ supabase, authAdmin, userId, newPassword, auditLog, req }) {
  const actor = await getCurrentActor(supabase, authAdmin);
  const targetUser = await getUserById(supabase, userId);
  assertManagedUserAccess(actor, targetUser);

  assertMasterProtection({
    targetUser,
    actorUser: actor,
  });

  if (!newPassword || String(newPassword).length < 6) {
    const error = new Error('A nova senha deve ter pelo menos 6 caracteres.');
    error.statusCode = 400;
    throw error;
  }

  if (!targetUser.auth_user_id) throw accessError('Conta sem vínculo com o login.');
  const { data: authTarget, error: authTargetError } = await supabase.auth.admin.getUserById(targetUser.auth_user_id);
  if (authTargetError || !authTarget?.user || String(authTarget.user.email).toLowerCase() !== String(targetUser.email).toLowerCase()) {
    throw accessError('Conta sem vínculo válido com o login.');
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

async function listLogs(supabase, filters = {}, actor) {
  if (!actor?.is_master) throw accessError("Logs globais são reservados aos administradores globais.");
  let query = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters.search) {
    query = query.or(
      `actor_email.ilike.%${filters.search}%,description.ilike.%${filters.search}%,entity_label.ilike.%${filters.search}%`
    );
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
