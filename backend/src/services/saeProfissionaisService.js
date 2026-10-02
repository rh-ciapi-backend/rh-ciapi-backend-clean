const MODULE_NAME = 'sae_profissionais';
const DEFAULT_PROFILE = 'CONSULTA';
const DEFAULT_ENVIRONMENT = 'SAE';

function safeString(value) {
  return String(value ?? '').trim();
}

function normalizeCpf(value) {
  return safeString(value).replace(/\D/g, '');
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => safeString(value))
        .filter(Boolean),
    ),
  );
}

function createHttpError(message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function normalizeServico(row) {
  return {
    id: safeString(row.id),
    nome: safeString(row.nome),
    sigla: safeString(row.sigla) || null,
    ativo: Boolean(row.ativo),
  };
}

function maskCpf(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11) return cpf ? '***' : null;
  return `${cpf.slice(0, 3)}.***.***-${cpf.slice(-2)}`;
}

function defaultPasswordFromCpf(value) {
  const cpf = normalizeCpf(value);

  if (cpf.length < 5) {
    throw createHttpError(
      'O servidor precisa possuir CPF válido no CIAPI RH para criação da conta de acesso.',
      400,
    );
  }

  // Supabase/CIAPI exige pelo menos 6 caracteres.
  // Mantém a regra solicitada dos 5 primeiros dígitos acrescida de "@".
  return `${cpf.slice(0, 5)}@`;
}

function normalizeServidor(row) {
  if (!row) return null;

  return {
    id: safeString(row.servidor || row.id || row.servidor_id || row.uuid),
    nome: safeString(row.nome_completo || row.nome),
    matricula: safeString(row.matricula),
    cpf: safeString(row.cpf),
    cpfMascarado: maskCpf(row.cpf),
    email: safeString(row.email).toLowerCase(),
    telefone: safeString(row.telefone),
    cargo: safeString(row.cargo),
    funcao: safeString(row.funcao),
    profissao: safeString(row.profissao),
    setor: safeString(row.setor),
    lotacaoInterna: safeString(row.lotacao_interna),
    categoria: safeString(row.categoria),
    status: safeString(row.status || 'ATIVO').toUpperCase(),
  };
}

function normalizeProfissional(row, servicoIds = [], servidor = null, conta = null) {
  const servidorNormalizado = servidor ? normalizeServidor(servidor) : null;

  return {
    id: safeString(row.id),
    servidorId: safeString(row.servidor_id) || null,
    authUserId: safeString(row.auth_user_id) || null,

    // Para profissionais vinculados ao RH, dados pessoais sempre vêm de servidores.
    nome: servidorNormalizado?.nome || safeString(row.nome),
    matricula: servidorNormalizado?.matricula || null,
    cpfMascarado: servidorNormalizado?.cpfMascarado || null,
    registroProfissional: safeString(row.registro_profissional) || null,
    conselho: safeString(row.conselho) || null,
    cargoFuncao:
      servidorNormalizado?.cargo ||
      servidorNormalizado?.funcao ||
      servidorNormalizado?.profissao ||
      safeString(row.cargo_funcao) ||
      null,
    telefone: servidorNormalizado?.telefone || safeString(row.telefone) || null,
    email: servidorNormalizado?.email || safeString(row.email) || null,
    setor: servidorNormalizado?.setor || null,
    categoria: servidorNormalizado?.categoria || null,
    ativo: Boolean(row.ativo),
    senhaProvisoria: Boolean(row.senha_provisoria),
    contaStatus: conta?.status || (row.auth_user_id ? 'ATIVO' : 'SEM_CONTA'),
    contaAmbiente: conta?.ambiente || null,
    servicoIds: uniqueStrings(servicoIds),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function listarServicos(supabase) {
  const { data, error } = await supabase
    .from('sae_servicos')
    .select('id,nome,sigla,ativo')
    .order('nome', { ascending: true });

  if (error) throw error;

  return (data || []).map(normalizeServico);
}

async function listarVinculos(supabase) {
  const { data, error } = await supabase
    .from('sae_profissional_servicos')
    .select('id,profissional_id,servico_id,ativo');

  if (error) throw error;

  return data || [];
}

async function loadServidoresMap(supabase, ids) {
  const uniqueIds = uniqueStrings(ids);
  if (!uniqueIds.length) return new Map();

  const { data, error } = await supabase
    .from('servidores')
    .select(
      'servidor,nome_completo,matricula,cpf,email,telefone,cargo,funcao,profissao,setor,lotacao_interna,categoria,status',
    )
    .in('servidor', uniqueIds);

  if (error) throw error;

  return new Map((data || []).map((item) => [safeString(item.servidor), item]));
}

async function loadContasMap(supabase, authIds) {
  const ids = uniqueStrings(authIds);
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from('system_users')
    .select('id,auth_user_id,email,status,ambiente,perfil')
    .in('auth_user_id', ids);

  if (error) throw error;

  return new Map((data || []).map((item) => [safeString(item.auth_user_id), item]));
}

async function listarProfissionais(supabase) {
  const [profissionaisResponse, servicos, vinculos] = await Promise.all([
    supabase
      .from('sae_profissionais')
      .select('*')
      .order('nome', { ascending: true }),
    listarServicos(supabase),
    listarVinculos(supabase),
  ]);

  if (profissionaisResponse.error) {
    throw profissionaisResponse.error;
  }

  const rows = profissionaisResponse.data || [];
  const [servidoresMap, contasMap] = await Promise.all([
    loadServidoresMap(
      supabase,
      rows.map((row) => row.servidor_id),
    ),
    loadContasMap(
      supabase,
      rows.map((row) => row.auth_user_id),
    ),
  ]);

  const servicosPorProfissional = new Map();

  for (const vinculo of vinculos) {
    if (!vinculo.ativo) continue;

    const profissionalId = safeString(vinculo.profissional_id);
    const servicoId = safeString(vinculo.servico_id);

    if (!profissionalId || !servicoId) continue;

    const lista = servicosPorProfissional.get(profissionalId) || [];
    lista.push(servicoId);
    servicosPorProfissional.set(profissionalId, lista);
  }

  const profissionais = rows
    .map((row) =>
      normalizeProfissional(
        row,
        servicosPorProfissional.get(safeString(row.id)) || [],
        servidoresMap.get(safeString(row.servidor_id)) || null,
        contasMap.get(safeString(row.auth_user_id)) || null,
      ),
    )
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return { profissionais, servicos };
}

async function obterProfissionalRow(supabase, profissionalId) {
  const id = safeString(profissionalId);

  if (!id) {
    throw createHttpError('Profissional inválido.', 400);
  }

  const { data, error } = await supabase
    .from('sae_profissionais')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw createHttpError('Profissional não encontrado.', 404);
  }

  return data;
}

async function obterProfissionalPorId(supabase, profissionalId) {
  const row = await obterProfissionalRow(supabase, profissionalId);

  const [vinculosResponse, servidorMap, contasMap] = await Promise.all([
    supabase
      .from('sae_profissional_servicos')
      .select('servico_id,ativo')
      .eq('profissional_id', row.id),
    loadServidoresMap(supabase, [row.servidor_id]),
    loadContasMap(supabase, [row.auth_user_id]),
  ]);

  if (vinculosResponse.error) throw vinculosResponse.error;

  const servicoIds = (vinculosResponse.data || [])
    .filter((item) => item.ativo)
    .map((item) => safeString(item.servico_id))
    .filter(Boolean);

  return normalizeProfissional(
    row,
    servicoIds,
    servidorMap.get(safeString(row.servidor_id)) || null,
    contasMap.get(safeString(row.auth_user_id)) || null,
  );
}

async function validarServicos(supabase, servicoIds) {
  const ids = uniqueStrings(servicoIds);

  if (ids.length === 0) {
    return ids;
  }

  const { data, error } = await supabase
    .from('sae_servicos')
    .select('id')
    .in('id', ids);

  if (error) throw error;

  const encontrados = new Set((data || []).map((item) => safeString(item.id)));
  const invalidos = ids.filter((id) => !encontrados.has(id));

  if (invalidos.length > 0) {
    throw createHttpError('Um ou mais serviços informados não existem.', 400);
  }

  return ids;
}

function escapeSearchTerm(value) {
  return safeString(value)
    .replace(/[(),]/g, ' ')
    .replace(/[%_]/g, '')
    .trim();
}

async function buscarServidores(supabase, busca, limit = 20) {
  const termo = escapeSearchTerm(busca);

  if (termo.length < 2) {
    return { servidores: [] };
  }

  const limite = Math.min(Math.max(Number(limit) || 20, 1), 30);
  const cpf = normalizeCpf(termo);
  const filtros = [
    `nome_completo.ilike.%${termo}%`,
    `matricula.ilike.%${termo}%`,
  ];

  if (cpf) {
    filtros.push(`cpf.ilike.%${cpf}%`);
  }

  const { data, error } = await supabase
    .from('servidores')
    .select(
      'servidor,nome_completo,matricula,cpf,email,telefone,cargo,funcao,profissao,setor,lotacao_interna,categoria,status',
    )
    .or(filtros.join(','))
    .eq('status', 'ATIVO')
    .order('nome_completo', { ascending: true })
    .limit(limite);

  if (error) throw error;

  const ids = (data || []).map((item) => item.servidor).filter(Boolean);

  let jaVinculados = new Set();
  if (ids.length) {
    const { data: vinculados, error: vincError } = await supabase
      .from('sae_profissionais')
      .select('servidor_id')
      .in('servidor_id', ids);

    if (vincError) throw vincError;

    jaVinculados = new Set(
      (vinculados || []).map((item) => safeString(item.servidor_id)),
    );
  }

  return {
    servidores: (data || []).map((row) => ({
      ...normalizeServidor(row),
      jaVinculado: jaVinculados.has(safeString(row.servidor)),
    })),
  };
}

async function obterServidorAtivo(supabase, servidorId) {
  const id = safeString(servidorId);

  if (!id) {
    throw createHttpError('Selecione um servidor do CIAPI RH.', 400);
  }

  const { data, error } = await supabase
    .from('servidores')
    .select(
      'servidor,nome_completo,matricula,cpf,email,telefone,cargo,funcao,profissao,setor,lotacao_interna,categoria,status',
    )
    .eq('servidor', id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw createHttpError('Servidor não encontrado no CIAPI RH.', 404);
  }

  const servidor = normalizeServidor(data);

  if (servidor.status !== 'ATIVO') {
    throw createHttpError(
      'Somente servidores ativos do CIAPI RH podem ser vinculados como profissionais do SAE.',
      409,
    );
  }

  if (!servidor.email || !servidor.email.includes('@')) {
    throw createHttpError(
      'Este servidor não possui e-mail válido no CIAPI RH. Atualize o cadastro do servidor antes de criar o acesso ao SAE.',
      400,
    );
  }

  if (normalizeCpf(servidor.cpf).length !== 11) {
    throw createHttpError(
      'Este servidor não possui CPF válido no CIAPI RH. Atualize o cadastro antes de continuar.',
      400,
    );
  }

  return { raw: data, servidor };
}

async function findAuthUserByEmail(supabase, email) {
  const target = safeString(email).toLowerCase();
  let page = 1;

  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    });

    if (error) throw error;

    const users = data?.users || [];
    const found = users.find(
      (item) => safeString(item.email).toLowerCase() === target,
    );

    if (found) return found;
    if (users.length < 100) break;
    page += 1;
  }

  return null;
}

async function ensureProfessionalAccount(supabase, servidor) {
  const email = safeString(servidor.email).toLowerCase();
  const senhaTemporaria = defaultPasswordFromCpf(servidor.cpf);

  const { data: existingSystem, error: existingSystemError } = await supabase
    .from('system_users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (existingSystemError) throw existingSystemError;

  if (existingSystem) {
    const ambiente = safeString(existingSystem.ambiente || 'RH').toUpperCase();

    if (ambiente !== DEFAULT_ENVIRONMENT) {
      throw createHttpError(
        'Este e-mail já possui uma conta interna vinculada ao ambiente RH. Para não alterar o acesso existente, regularize essa conta antes de vinculá-la ao SAE.',
        409,
      );
    }

    if (!existingSystem.auth_user_id) {
      throw createHttpError(
        'A conta existente no SAE está sem vínculo com o Supabase Auth. Regularize a conta antes de continuar.',
        409,
      );
    }

    if (existingSystem.status !== 'ATIVO') {
      const { error: activateError } = await supabase
        .from('system_users')
        .update({
          status: 'ATIVO',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingSystem.id);

      if (activateError) throw activateError;
    }

    return {
      authUserId: safeString(existingSystem.auth_user_id),
      systemUserId: safeString(existingSystem.id),
      senhaTemporaria: null,
      contaReutilizada: true,
    };
  }

  let authUser = await findAuthUserByEmail(supabase, email);
  let authCreatedNow = false;

  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: senhaTemporaria,
      email_confirm: true,
      user_metadata: {
        nome_completo: servidor.nome,
        ambiente: DEFAULT_ENVIRONMENT,
        profissional_sae: true,
      },
    });

    if (error) {
      throw createHttpError(
        error.message || 'Não foi possível criar o login do profissional.',
        400,
      );
    }

    authUser = data?.user || null;
    authCreatedNow = true;
  }

  if (!authUser?.id) {
    throw createHttpError('Não foi possível obter o usuário de autenticação.', 500);
  }

  const { data: systemUser, error: insertError } = await supabase
    .from('system_users')
    .insert({
      auth_user_id: authUser.id,
      nome_completo: servidor.nome,
      email,
      perfil: DEFAULT_PROFILE,
      status: 'ATIVO',
      setor_nome: servidor.setor || 'SAE',
      ambiente: DEFAULT_ENVIRONMENT,
      is_master: false,
      tentativas_login_falhas: 0,
    })
    .select('*')
    .single();

  if (insertError) {
    if (authCreatedNow) {
      await supabase.auth.admin.deleteUser(authUser.id).catch(() => {});
    }
    throw insertError;
  }

  return {
    authUserId: safeString(authUser.id),
    systemUserId: safeString(systemUser.id),
    senhaTemporaria: authCreatedNow ? senhaTemporaria : null,
    contaReutilizada: !authCreatedNow,
  };
}

async function sincronizarServicos(supabase, profissionalId, servicoIds) {
  const desejados = new Set(uniqueStrings(servicoIds));

  const { data: existentes, error: existentesError } = await supabase
    .from('sae_profissional_servicos')
    .select('id,servico_id,ativo')
    .eq('profissional_id', profissionalId);

  if (existentesError) throw existentesError;

  const agora = new Date().toISOString();

  if (desejados.size > 0) {
    const payload = Array.from(desejados).map((servicoId) => ({
      profissional_id: profissionalId,
      servico_id: servicoId,
      ativo: true,
      updated_at: agora,
    }));

    const { error } = await supabase
      .from('sae_profissional_servicos')
      .upsert(payload, { onConflict: 'profissional_id,servico_id' });

    if (error) throw error;
  }

  const desativarIds = (existentes || [])
    .filter((item) => !desejados.has(safeString(item.servico_id)) && item.ativo)
    .map((item) => safeString(item.id))
    .filter(Boolean);

  if (desativarIds.length > 0) {
    const { error } = await supabase
      .from('sae_profissional_servicos')
      .update({ ativo: false, updated_at: agora })
      .in('id', desativarIds);

    if (error) throw error;
  }
}

async function createProfissional({
  supabase,
  authUser,
  actor,
  auditLog,
  payload,
  req,
}) {
  const servidorId = safeString(payload?.servidorId);
  const servicoIds = await validarServicos(supabase, payload?.servicoIds);

  if (!servicoIds.length) {
    throw createHttpError(
      'Selecione pelo menos um serviço realizado pelo profissional.',
      400,
    );
  }

  const { data: existingLink, error: linkError } = await supabase
    .from('sae_profissionais')
    .select('id')
    .eq('servidor_id', servidorId)
    .maybeSingle();

  if (linkError) throw linkError;

  if (existingLink) {
    throw createHttpError(
      'Este servidor já está vinculado como profissional do SAE.',
      409,
    );
  }

  const { servidor } = await obterServidorAtivo(supabase, servidorId);
  const account = await ensureProfessionalAccount(supabase, servidor);

  const insertPayload = {
    servidor_id: servidor.id,
    auth_user_id: account.authUserId,
    nome: servidor.nome,
    registro_profissional: safeString(payload?.registroProfissional) || null,
    conselho: safeString(payload?.conselho) || null,
    cargo_funcao:
      servidor.cargo || servidor.funcao || servidor.profissao || null,
    telefone: servidor.telefone || null,
    email: servidor.email || null,
    ativo: payload?.ativo !== false,
    senha_provisoria: Boolean(account.senhaTemporaria),
    created_by: authUser?.id || null,
    updated_by: authUser?.id || null,
  };

  const { data, error } = await supabase
    .from('sae_profissionais')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  try {
    await sincronizarServicos(supabase, data.id, servicoIds);
  } catch (errorSync) {
    await supabase.from('sae_profissionais').delete().eq('id', data.id);
    throw errorSync;
  }

  const profissional = await obterProfissionalPorId(supabase, data.id);

  await auditLog(req, {
    action: 'CREATE_SAE_PROFISSIONAL',
    module: MODULE_NAME,
    entityType: 'sae_profissional',
    entityId: profissional.id,
    entityLabel: profissional.nome,
    description: `Servidor ${profissional.nome} vinculado como profissional do SAE por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: {
      servidor_id: servidor.id,
      matricula: servidor.matricula,
      auth_user_id: account.authUserId,
      conta_reutilizada: account.contaReutilizada,
      servico_ids: profissional.servicoIds,
    },
  });

  return {
    profissional,
    senhaTemporaria: account.senhaTemporaria,
    contaReutilizada: account.contaReutilizada,
  };
}

async function updateProfissional({
  supabase,
  authUser,
  actor,
  auditLog,
  profissionalId,
  payload,
  req,
}) {
  const atualRow = await obterProfissionalRow(supabase, profissionalId);
  const atual = await obterProfissionalPorId(supabase, profissionalId);

  const servicoIds =
    payload?.servicoIds === undefined
      ? atual.servicoIds
      : await validarServicos(supabase, payload.servicoIds);

  if (!servicoIds.length) {
    throw createHttpError(
      'Selecione pelo menos um serviço realizado pelo profissional.',
      400,
    );
  }

  let dadosServidor = null;
  if (atualRow.servidor_id) {
    const { servidor } = await obterServidorAtivo(supabase, atualRow.servidor_id);
    dadosServidor = servidor;
  }

  const updatePayload = {
    registro_profissional:
      payload?.registroProfissional === undefined
        ? atual.registroProfissional
        : safeString(payload.registroProfissional) || null,
    conselho:
      payload?.conselho === undefined
        ? atual.conselho
        : safeString(payload.conselho) || null,
    ativo:
      typeof payload?.ativo === 'boolean' ? payload.ativo : atual.ativo,
    updated_at: new Date().toISOString(),
    updated_by: authUser?.id || null,
  };

  if (dadosServidor) {
    updatePayload.nome = dadosServidor.nome;
    updatePayload.cargo_funcao =
      dadosServidor.cargo ||
      dadosServidor.funcao ||
      dadosServidor.profissao ||
      null;
    updatePayload.telefone = dadosServidor.telefone || null;
    updatePayload.email = dadosServidor.email || null;
  }

  const { error } = await supabase
    .from('sae_profissionais')
    .update(updatePayload)
    .eq('id', atual.id);

  if (error) throw error;

  await sincronizarServicos(supabase, atual.id, servicoIds);

  const profissional = await obterProfissionalPorId(supabase, atual.id);

  await auditLog(req, {
    action: 'UPDATE_SAE_PROFISSIONAL',
    module: MODULE_NAME,
    entityType: 'sae_profissional',
    entityId: profissional.id,
    entityLabel: profissional.nome,
    description: `Profissional ${profissional.nome} atualizado por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: {
      servicos_anteriores: atual.servicoIds,
      servicos_atuais: profissional.servicoIds,
    },
  });

  return profissional;
}

async function updateProfissionalStatus({
  supabase,
  authUser,
  actor,
  auditLog,
  profissionalId,
  ativo,
  req,
}) {
  if (typeof ativo !== 'boolean') {
    throw createHttpError('Informe um status válido para o profissional.', 400);
  }

  const atual = await obterProfissionalRow(supabase, profissionalId);

  const { error } = await supabase
    .from('sae_profissionais')
    .update({
      ativo,
      updated_at: new Date().toISOString(),
      updated_by: authUser?.id || null,
    })
    .eq('id', atual.id);

  if (error) throw error;

  if (atual.auth_user_id) {
    const { error: userError } = await supabase
      .from('system_users')
      .update({
        status: ativo ? 'ATIVO' : 'INATIVO',
        updated_at: new Date().toISOString(),
      })
      .eq('auth_user_id', atual.auth_user_id)
      .eq('ambiente', 'SAE');

    if (userError) throw userError;
  }

  const profissional = await obterProfissionalPorId(supabase, atual.id);

  await auditLog(req, {
    action: 'UPDATE_SAE_PROFISSIONAL_STATUS',
    module: MODULE_NAME,
    entityType: 'sae_profissional',
    entityId: profissional.id,
    entityLabel: profissional.nome,
    description: `Profissional ${profissional.nome} ${ativo ? 'ativado' : 'inativado'} por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: { ativo },
  });

  return profissional;
}

async function resetProfessionalPassword({
  supabase,
  actor,
  auditLog,
  profissionalId,
  req,
}) {
  const row = await obterProfissionalRow(supabase, profissionalId);

  if (!row.servidor_id) {
    throw createHttpError(
      'Este profissional não está vinculado a um servidor do CIAPI RH.',
      409,
    );
  }

  if (!row.auth_user_id) {
    throw createHttpError(
      'Este profissional ainda não possui conta de acesso vinculada.',
      409,
    );
  }

  const { servidor } = await obterServidorAtivo(supabase, row.servidor_id);
  const senhaTemporaria = defaultPasswordFromCpf(servidor.cpf);

  const { error } = await supabase.auth.admin.updateUserById(row.auth_user_id, {
    password: senhaTemporaria,
  });

  if (error) {
    throw createHttpError(
      error.message || 'Não foi possível redefinir a senha do profissional.',
      400,
    );
  }

  const { error: updateError } = await supabase
    .from('sae_profissionais')
    .update({
      senha_provisoria: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  if (updateError) throw updateError;

  await auditLog(req, {
    action: 'RESET_SAE_PROFISSIONAL_PASSWORD',
    module: MODULE_NAME,
    entityType: 'sae_profissional',
    entityId: row.id,
    entityLabel: servidor.nome,
    description: `Senha provisória de ${servidor.nome} redefinida por ${actor?.email || 'administrador'}.`,
    metadata: {},
  });

  return {
    ok: true,
    senhaTemporaria,
    mensagem:
      'Senha redefinida. O profissional deve alterar a senha após entrar no SAE.',
  };
}

async function changeMyPassword({
  supabase,
  authUser,
  actor,
  auditLog,
  newPassword,
  req,
}) {
  const senha = safeString(newPassword);

  if (senha.length < 6) {
    throw createHttpError('A nova senha deve ter pelo menos 6 caracteres.', 400);
  }

  const { data: profissional, error: profError } = await supabase
    .from('sae_profissionais')
    .select('id,nome,auth_user_id')
    .eq('auth_user_id', authUser.id)
    .eq('ativo', true)
    .maybeSingle();

  if (profError) throw profError;

  if (!profissional) {
    throw createHttpError(
      'Seu login não está vinculado a um profissional ativo do SAE.',
      403,
    );
  }

  const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
    password: senha,
  });

  if (error) {
    throw createHttpError(
      error.message || 'Não foi possível alterar sua senha.',
      400,
    );
  }

  const { error: updateError } = await supabase
    .from('sae_profissionais')
    .update({
      senha_provisoria: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profissional.id);

  if (updateError) throw updateError;

  await auditLog(req, {
    action: 'CHANGE_OWN_SAE_PASSWORD',
    module: MODULE_NAME,
    entityType: 'sae_profissional',
    entityId: profissional.id,
    entityLabel: profissional.nome,
    description: `Profissional ${profissional.nome} alterou a própria senha.`,
    metadata: {
      actor_email: actor?.email || authUser?.email || null,
    },
  });

  return { ok: true };
}

async function countReferences(supabase, tableName, profissionalId) {
  const { count, error } = await supabase
    .from(tableName)
    .select('id', { count: 'exact', head: true })
    .eq('profissional_id', profissionalId);

  if (error) throw error;
  return Number(count || 0);
}

async function deleteProfissional({
  supabase,
  actor,
  auditLog,
  profissionalId,
  req,
}) {
  const atual = await obterProfissionalPorId(supabase, profissionalId);
  const row = await obterProfissionalRow(supabase, profissionalId);

  const [agendamentos, agenda, bloqueios] = await Promise.all([
    countReferences(supabase, 'sae_agendamento_servicos', atual.id),
    countReferences(supabase, 'sae_agenda_profissionais', atual.id),
    countReferences(supabase, 'sae_bloqueios_agenda', atual.id),
  ]);

  if (agendamentos + agenda + bloqueios > 0) {
    throw createHttpError(
      'Este profissional já possui vínculos no SAE e não pode ser excluído. Inative o profissional.',
      409,
      { agendamentos, agenda, bloqueios },
    );
  }

  const { error: linksError } = await supabase
    .from('sae_profissional_servicos')
    .delete()
    .eq('profissional_id', atual.id);

  if (linksError) throw linksError;

  const { error } = await supabase
    .from('sae_profissionais')
    .delete()
    .eq('id', atual.id);

  if (error) throw error;

  if (row.auth_user_id) {
    await supabase
      .from('system_users')
      .update({
        status: 'INATIVO',
        updated_at: new Date().toISOString(),
      })
      .eq('auth_user_id', row.auth_user_id)
      .eq('ambiente', 'SAE');
  }

  await auditLog(req, {
    action: 'DELETE_SAE_PROFISSIONAL',
    module: MODULE_NAME,
    entityType: 'sae_profissional',
    entityId: atual.id,
    entityLabel: atual.nome,
    description: `Profissional ${atual.nome} removido do SAE por ${actor?.email || 'administrador'}.`,
    metadata: {},
  });

  return { ok: true };
}

module.exports = {
  listarProfissionais,
  listar: listarProfissionais,
  buscarServidores,
  obterProfissionalPorId,
  createProfissional,
  updateProfissional,
  updateProfissionalStatus,
  resetProfessionalPassword,
  changeMyPassword,
  deleteProfissional,
};
