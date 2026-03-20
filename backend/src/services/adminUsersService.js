async function createUser({ supabase, authAdmin, auditLog, payload, req }) {
  const actor = await getCurrentActor(supabase, authAdmin);

  if (
    !actor.is_master &&
    !(actor.permissions || []).some(
      (item) => item.module === 'administracao' && item.actions.includes('gerenciar_usuarios'),
    )
  ) {
    const error = new Error('Você não possui permissão para criar usuários.');
    error.statusCode = 403;
    throw error;
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const isMaster = isMasterEmail(email);
  const perfil = isMaster ? PROFILES.MASTER : payload.perfil || PROFILES.CONSULTA;
  const status = isMaster ? 'ATIVO' : payload.status || 'ATIVO';
  const setor_nome = payload.setor_nome ? String(payload.setor_nome).trim() : null;
  const senhaInicial = String(payload.senha_inicial || payload.password || '').trim();

  if (!isMaster && senhaInicial.length < 6) {
    const error = new Error('Informe uma senha inicial com pelo menos 6 caracteres.');
    error.statusCode = 400;
    throw error;
  }

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

  if (!isMaster) {
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

    if (!authUserId) {
      const error = new Error('Usuário criado sem identificador de autenticação.');
      error.statusCode = 500;
      throw error;
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
      is_master: isMaster,
      tentativas_login_falhas: 0,
    })
    .select('*')
    .single();

  if (error) {
    if (authUserId) {
      await supabase.auth.admin.deleteUser(authUserId).catch(() => null);
    }
    throw error;
  }

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
      setor_nome,
      auth_user_id: authUserId,
    },
  });

  return normalizeManagedUser(data, permissions);
}
