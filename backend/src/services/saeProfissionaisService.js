const MODULE_NAME = 'sae_profissionais';

function safeString(value) {
  return String(value ?? '').trim();
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

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
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

function normalizeProfissional(row, servicoIds = []) {
  return {
    id: safeString(row.id),
    authUserId: safeString(row.auth_user_id) || null,
    nome: safeString(row.nome),
    registroProfissional: safeString(row.registro_profissional) || null,
    conselho: safeString(row.conselho) || null,
    cargoFuncao: safeString(row.cargo_funcao) || null,
    telefone: safeString(row.telefone) || null,
    email: safeString(row.email) || null,
    ativo: Boolean(row.ativo),
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

  const profissionais = (profissionaisResponse.data || []).map((row) =>
    normalizeProfissional(
      row,
      servicosPorProfissional.get(safeString(row.id)) || [],
    ),
  );

  return { profissionais, servicos };
}

async function obterProfissionalPorId(supabase, profissionalId) {
  const id = safeString(profissionalId);

  if (!id) {
    throw createHttpError('Profissional inválido.', 400);
  }

  const [profissionalResponse, vinculosResponse] = await Promise.all([
    supabase
      .from('sae_profissionais')
      .select('*')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('sae_profissional_servicos')
      .select('servico_id,ativo')
      .eq('profissional_id', id),
  ]);

  if (profissionalResponse.error) throw profissionalResponse.error;
  if (vinculosResponse.error) throw vinculosResponse.error;

  if (!profissionalResponse.data) {
    throw createHttpError('Profissional não encontrado.', 404);
  }

  const servicoIds = (vinculosResponse.data || [])
    .filter((item) => item.ativo)
    .map((item) => safeString(item.servico_id))
    .filter(Boolean);

  return normalizeProfissional(profissionalResponse.data, servicoIds);
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

function buildCreatePayload(payload, authUserId) {
  const nome = safeString(payload?.nome);

  if (!nome) {
    throw createHttpError('Informe o nome do profissional.', 400);
  }

  return {
    nome,
    registro_profissional: safeString(payload?.registroProfissional) || null,
    conselho: safeString(payload?.conselho) || null,
    cargo_funcao: safeString(payload?.cargoFuncao) || null,
    telefone: safeString(payload?.telefone) || null,
    email: safeString(payload?.email) || null,
    ativo: payload?.ativo !== false,
    created_by: authUserId || null,
    updated_by: authUserId || null,
  };
}

function buildUpdatePayload(payload, atual, authUserId) {
  const nome = safeString(payload?.nome ?? atual.nome);

  if (!nome) {
    throw createHttpError('Informe o nome do profissional.', 400);
  }

  return {
    nome,
    registro_profissional:
      payload?.registroProfissional === undefined
        ? atual.registroProfissional
        : safeString(payload.registroProfissional) || null,
    conselho:
      payload?.conselho === undefined
        ? atual.conselho
        : safeString(payload.conselho) || null,
    cargo_funcao:
      payload?.cargoFuncao === undefined
        ? atual.cargoFuncao
        : safeString(payload.cargoFuncao) || null,
    telefone:
      payload?.telefone === undefined
        ? atual.telefone
        : safeString(payload.telefone) || null,
    email:
      payload?.email === undefined
        ? atual.email
        : safeString(payload.email) || null,
    ativo:
      typeof payload?.ativo === 'boolean' ? payload.ativo : atual.ativo,
    updated_at: new Date().toISOString(),
    updated_by: authUserId || null,
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

async function createProfissional({ supabase, authUser, actor, auditLog, payload, req }) {
  const servicoIds = await validarServicos(supabase, payload?.servicoIds);
  const profissionalPayload = buildCreatePayload(payload, authUser?.id);

  const { data, error } = await supabase
    .from('sae_profissionais')
    .insert(profissionalPayload)
    .select('*')
    .single();

  if (error) throw error;

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
    description: `Profissional ${profissional.nome} criado por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: {
      ativo: profissional.ativo,
      servico_ids: profissional.servicoIds,
    },
  });

  return profissional;
}

async function updateProfissional({ supabase, authUser, actor, auditLog, profissionalId, payload, req }) {
  const atual = await obterProfissionalPorId(supabase, profissionalId);
  const servicoIds =
    payload?.servicoIds === undefined
      ? atual.servicoIds
      : await validarServicos(supabase, payload.servicoIds);

  const updatePayload = buildUpdatePayload(payload, atual, authUser?.id);

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
      ativo_anterior: atual.ativo,
      ativo_atual: profissional.ativo,
      servicos_anteriores: atual.servicoIds,
      servicos_atuais: profissional.servicoIds,
    },
  });

  return profissional;
}

async function updateProfissionalStatus({ supabase, authUser, actor, auditLog, profissionalId, ativo, req }) {
  if (typeof ativo !== 'boolean') {
    throw createHttpError('Informe um status válido para o profissional.', 400);
  }

  const atual = await obterProfissionalPorId(supabase, profissionalId);

  const { error } = await supabase
    .from('sae_profissionais')
    .update({
      ativo,
      updated_at: new Date().toISOString(),
      updated_by: authUser?.id || null,
    })
    .eq('id', atual.id);

  if (error) throw error;

  const profissional = await obterProfissionalPorId(supabase, atual.id);

  await auditLog(req, {
    action: 'UPDATE_SAE_PROFISSIONAL_STATUS',
    module: MODULE_NAME,
    entityType: 'sae_profissional',
    entityId: profissional.id,
    entityLabel: profissional.nome,
    description: `Profissional ${profissional.nome} ${ativo ? 'ativado' : 'inativado'} por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: {
      ativo_anterior: atual.ativo,
      ativo_atual: ativo,
    },
  });

  return profissional;
}

async function countReferences(supabase, tableName, profissionalId) {
  const { count, error } = await supabase
    .from(tableName)
    .select('id', { count: 'exact', head: true })
    .eq('profissional_id', profissionalId);

  if (error) throw error;
  return Number(count || 0);
}

async function deleteProfissional({ supabase, actor, auditLog, profissionalId, req }) {
  const atual = await obterProfissionalPorId(supabase, profissionalId);

  const [agendamentos, agenda, bloqueios] = await Promise.all([
    countReferences(supabase, 'sae_agendamento_servicos', atual.id),
    countReferences(supabase, 'sae_agenda_profissionais', atual.id),
    countReferences(supabase, 'sae_bloqueios_agenda', atual.id),
  ]);

  if (agendamentos > 0 || agenda > 0 || bloqueios > 0) {
    throw createHttpError(
      'Este profissional possui histórico ou configuração de agenda vinculada. Inative o cadastro em vez de excluí-lo.',
      409,
    );
  }

  const { error } = await supabase
    .from('sae_profissionais')
    .delete()
    .eq('id', atual.id);

  if (error) throw error;

  await auditLog(req, {
    action: 'DELETE_SAE_PROFISSIONAL',
    module: MODULE_NAME,
    entityType: 'sae_profissional',
    entityId: atual.id,
    entityLabel: atual.nome,
    description: `Profissional ${atual.nome} excluído por ${actor?.email || 'usuário autenticado'}.`,
    metadata: {
      servico_ids: atual.servicoIds,
    },
  });

  return { ok: true };
}

module.exports = {
  listarProfissionais,
  obterProfissionalPorId,
  createProfissional,
  updateProfissional,
  updateProfissionalStatus,
  deleteProfissional,
};
