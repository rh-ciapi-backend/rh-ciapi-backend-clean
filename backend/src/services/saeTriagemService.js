const MODULE_NAME = 'sae_triagem';

const ETAPAS = [
  { etapa: 'SERVICO_SOCIAL', ordem: 1 },
  { etapa: 'ENFERMAGEM', ordem: 2 },
  { etapa: 'PSICOLOGIA', ordem: 3 },
  { etapa: 'MEDICO', ordem: 4 },
  { etapa: 'TERAPIA_OCUPACIONAL', ordem: 5 },
];

function safeString(value) {
  return String(value ?? '').trim();
}

function httpError(message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function normalizeEtapa(value) {
  const etapa = safeString(value).toUpperCase();

  if (!ETAPAS.some((item) => item.etapa === etapa)) {
    throw httpError('Etapa de triagem inválida.', 400);
  }

  return etapa;
}

function mapEtapa(row) {
  return {
    id: safeString(row.id),
    triagemId: safeString(row.triagem_id),
    etapa: safeString(row.etapa),
    ordem: Number(row.ordem),
    status: safeString(row.status),
    profissionalId: safeString(row.profissional_id) || null,
    agendamentoId: safeString(row.agendamento_id) || null,
    dataAgendada: safeString(row.data_agendada) || null,
    dataConclusao: safeString(row.data_conclusao) || null,
    parecer: safeString(row.parecer) || null,
    observacao: safeString(row.observacao) || null,
    createdAt: safeString(row.created_at) || null,
    updatedAt: safeString(row.updated_at) || null,
  };
}

function mapTriagem(row, etapas = []) {
  return {
    id: safeString(row.id),
    usuarioId: safeString(row.usuario_id) || null,
    nome: safeString(row.nome),
    sexo: safeString(row.sexo) || null,
    dataNascimento: safeString(row.data_nascimento) || null,
    telefone: safeString(row.telefone) || null,
    observacaoInicial: safeString(row.observacao_inicial) || null,
    status: safeString(row.status),
    etapaAtual: safeString(row.etapa_atual),
    resultadoObservacao: safeString(row.resultado_observacao) || null,
    concluidoEm: safeString(row.concluido_em) || null,
    protocoloMatricula: safeString(row.protocolo_matricula) || null,
    matriculadoEm: safeString(row.matriculado_em) || null,
    matriculadoPor: safeString(row.matriculado_por) || null,
    createdAt: safeString(row.created_at) || null,
    updatedAt: safeString(row.updated_at) || null,
    etapas: etapas.sort((a, b) => a.ordem - b.ordem),
  };
}

async function carregarEtapas(supabase, triagemIds) {
  if (!triagemIds.length) return new Map();

  const { data, error } = await supabase
    .from('sae_triagem_etapas')
    .select('*')
    .in('triagem_id', triagemIds)
    .order('ordem', { ascending: true });

  if (error) throw error;

  const mapa = new Map();

  for (const row of data || []) {
    const triagemId = safeString(row.triagem_id);
    const lista = mapa.get(triagemId) || [];
    lista.push(mapEtapa(row));
    mapa.set(triagemId, lista);
  }

  return mapa;
}

async function listar(supabase, filtros = {}) {
  let query = supabase
    .from('sae_triagens')
    .select('*')
    .order('created_at', { ascending: false });

  const status = safeString(filtros.status);
  const etapa = safeString(filtros.etapa);

  if (status && status !== 'TODOS') {
    query = query.eq('status', status);
  }

  if (etapa && etapa !== 'TODAS') {
    query = query.eq('etapa_atual', etapa);
  }

  const { data, error } = await query;
  if (error) throw error;

  const ids = (data || []).map((row) => safeString(row.id));
  const etapasMap = await carregarEtapas(supabase, ids);

  let triagens = (data || []).map((row) =>
    mapTriagem(row, etapasMap.get(safeString(row.id)) || []),
  );

  const busca = safeString(filtros.busca).toLowerCase();

  if (busca) {
    triagens = triagens.filter((item) =>
      [item.nome, item.telefone, item.protocoloMatricula]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(busca),
        ),
    );
  }

  return { triagens };
}

async function obter(supabase, triagemId) {
  const id = safeString(triagemId);

  const { data, error } = await supabase
    .from('sae_triagens')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw httpError('Triagem não encontrada.', 404);

  const etapasMap = await carregarEtapas(supabase, [id]);

  return mapTriagem(data, etapasMap.get(id) || []);
}

async function criar({
  supabase,
  authUser,
  actor,
  auditLog,
  payload,
  req,
}) {
  const nome = safeString(payload?.nome);

  if (!nome) {
    throw httpError('Informe o nome da pessoa em triagem.', 400);
  }

  const usuarioId = safeString(payload?.usuarioId) || null;
  const nowUserId = authUser?.id || null;

  if (usuarioId) {
    const { data: usuario, error: usuarioError } = await supabase
      .from('sae_usuarios')
      .select('id,nome')
      .eq('id', usuarioId)
      .maybeSingle();

    if (usuarioError) throw usuarioError;
    if (!usuario) {
      throw httpError('Usuário vinculado não encontrado.', 404);
    }
  }

  const { data: triagem, error: triagemError } = await supabase
    .from('sae_triagens')
    .insert({
      usuario_id: usuarioId,
      nome,
      sexo: safeString(payload?.sexo) || null,
      data_nascimento: safeString(payload?.dataNascimento) || null,
      telefone: safeString(payload?.telefone) || null,
      observacao_inicial:
        safeString(payload?.observacaoInicial) || null,
      status: 'EM_TRIAGEM',
      etapa_atual: 'SERVICO_SOCIAL',
      created_by: nowUserId,
      updated_by: nowUserId,
    })
    .select('*')
    .single();

  if (triagemError) throw triagemError;

  try {
    const etapasPayload = ETAPAS.map((item) => ({
      triagem_id: triagem.id,
      etapa: item.etapa,
      ordem: item.ordem,
      status: 'PENDENTE',
      created_by: nowUserId,
      updated_by: nowUserId,
    }));

    const { error: etapasError } = await supabase
      .from('sae_triagem_etapas')
      .insert(etapasPayload);

    if (etapasError) throw etapasError;

    await auditLog(req, {
      action: 'CREATE_SAE_TRIAGEM',
      module: MODULE_NAME,
      entityType: 'sae_triagem',
      entityId: safeString(triagem.id),
      entityLabel: nome,
      description: `Triagem criada por ${
        actor?.email ||
        authUser?.email ||
        'usuário autenticado'
      }.`,
      metadata: {
        fluxo: ETAPAS.map((item) => item.etapa),
      },
    });

    return obter(supabase, triagem.id);
  } catch (error) {
    await supabase
      .from('sae_triagens')
      .delete()
      .eq('id', triagem.id);

    throw error;
  }
}

async function atualizarEtapa({
  supabase,
  authUser,
  actor,
  auditLog,
  triagemId,
  etapa,
  payload,
  req,
}) {
  const id = safeString(triagemId);
  const etapaNormalizada = normalizeEtapa(etapa);
  const status = safeString(payload?.status).toUpperCase();

  if (
    ![
      'PENDENTE',
      'AGENDADO',
      'CONCLUIDO',
      'NAO_COMPARECEU',
    ].includes(status)
  ) {
    throw httpError('Status da etapa inválido.', 400);
  }

  const triagem = await obter(supabase, id);

  if (
    ['NAO_APTO', 'DESISTENTE', 'MATRICULADO'].includes(
      triagem.status,
    )
  ) {
    throw httpError(
      'Esta triagem já possui situação final e não pode ser alterada.',
      409,
    );
  }

  const etapaAtual = triagem.etapas.find(
    (item) => item.etapa === etapaNormalizada,
  );

  if (!etapaAtual) {
    throw httpError(
      'Etapa não encontrada nesta triagem.',
      404,
    );
  }

  const parecer =
    safeString(payload?.parecer).toUpperCase() || null;

  if (
    parecer &&
    ![
      'FAVORAVEL',
      'PENDENCIA',
      'DESFAVORAVEL',
    ].includes(parecer)
  ) {
    throw httpError('Parecer inválido.', 400);
  }

  const patch = {
    status,
    profissional_id:
      safeString(payload?.profissionalId) || null,
    agendamento_id:
      safeString(payload?.agendamentoId) || null,
    data_agendada:
      safeString(payload?.dataAgendada) || null,
    parecer,
    observacao:
      safeString(payload?.observacao) || null,
    updated_by: authUser?.id || null,
  };

  if (status === 'CONCLUIDO') {
    patch.data_conclusao = new Date().toISOString();
  } else if (
    status === 'PENDENTE' ||
    status === 'AGENDADO'
  ) {
    patch.data_conclusao = null;
  }

  const { error } = await supabase
    .from('sae_triagem_etapas')
    .update(patch)
    .eq('id', etapaAtual.id);

  if (error) throw error;

  const atualizado = await obter(supabase, id);
  const concluidas = atualizado.etapas.filter(
    (item) => item.status === 'CONCLUIDO',
  );

  let novoStatus = 'EM_TRIAGEM';
  let novaEtapa = 'SERVICO_SOCIAL';

  if (concluidas.length === ETAPAS.length) {
    novoStatus = 'AGUARDANDO_DECISAO';
    novaEtapa = 'CONCLUIDA';
  } else {
    const primeiraPendente = atualizado.etapas.find(
      (item) => item.status !== 'CONCLUIDO',
    );

    novaEtapa =
      primeiraPendente?.etapa || 'CONCLUIDA';
  }

  const { error: triagemUpdateError } = await supabase
    .from('sae_triagens')
    .update({
      status: novoStatus,
      etapa_atual: novaEtapa,
      updated_by: authUser?.id || null,
    })
    .eq('id', id);

  if (triagemUpdateError) throw triagemUpdateError;

  await auditLog(req, {
    action: 'UPDATE_SAE_TRIAGEM_ETAPA',
    module: MODULE_NAME,
    entityType: 'sae_triagem',
    entityId: id,
    entityLabel: triagem.nome,
    description: `Etapa ${etapaNormalizada} atualizada por ${
      actor?.email ||
      authUser?.email ||
      'usuário autenticado'
    }.`,
    metadata: {
      etapa: etapaNormalizada,
      status,
      parecer,
    },
  });

  return obter(supabase, id);
}

async function decidir({
  supabase,
  authUser,
  actor,
  auditLog,
  triagemId,
  payload,
  req,
}) {
  const id = safeString(triagemId);
  const decisao =
    safeString(payload?.decisao).toUpperCase();

  if (
    !['APTO', 'NAO_APTO', 'DESISTENTE'].includes(
      decisao,
    )
  ) {
    throw httpError(
      'Decisão de triagem inválida.',
      400,
    );
  }

  const triagem = await obter(supabase, id);

  if (triagem.status === 'MATRICULADO') {
    throw httpError(
      'Esta triagem já foi convertida em matrícula.',
      409,
    );
  }

  if (decisao !== 'DESISTENTE') {
    const faltantes = triagem.etapas.filter(
      (item) => item.status !== 'CONCLUIDO',
    );

    if (faltantes.length > 0) {
      throw httpError(
        'Conclua Serviço Social, Enfermagem, Psicologia, Médico e Terapia Ocupacional antes da decisão final.',
        409,
        {
          etapasPendentes: faltantes.map(
            (item) => item.etapa,
          ),
        },
      );
    }
  }

  const { error } = await supabase
    .from('sae_triagens')
    .update({
      status: decisao,
      etapa_atual: 'CONCLUIDA',
      resultado_observacao:
        safeString(payload?.observacao) || null,
      concluido_em: new Date().toISOString(),
      updated_by: authUser?.id || null,
    })
    .eq('id', id);

  if (error) throw error;

  await auditLog(req, {
    action: 'DECIDE_SAE_TRIAGEM',
    module: MODULE_NAME,
    entityType: 'sae_triagem',
    entityId: id,
    entityLabel: triagem.nome,
    description: `Triagem finalizada como ${decisao} por ${
      actor?.email ||
      authUser?.email ||
      'usuário autenticado'
    }.`,
    metadata: {
      decisao,
      observacao:
        safeString(payload?.observacao) || null,
    },
  });

  return obter(supabase, id);
}

async function matricular({
  supabase,
  authUser,
  actor,
  auditLog,
  triagemId,
  payload,
  req,
}) {
  const id = safeString(triagemId);
  const turno =
    safeString(payload?.turno).toUpperCase() || null;

  if (
    turno &&
    !['MANHÃ', 'TARDE'].includes(turno)
  ) {
    throw httpError(
      'Turno inválido. Informe MANHÃ ou TARDE.',
      400,
    );
  }

  const triagemAntes = await obter(supabase, id);

  const faltantes = triagemAntes.etapas.filter(
    (item) => item.status !== 'CONCLUIDO',
  );

  if (
    triagemAntes.etapas.length !== ETAPAS.length ||
    faltantes.length > 0
  ) {
    throw httpError(
      'Conclua as cinco avaliações obrigatórias antes de emitir o protocolo e matricular.',
      409,
      {
        etapasPendentes: faltantes.map(
          (item) => item.etapa,
        ),
      },
    );
  }

  const { data, error } = await supabase.rpc(
    'sae_matricular_triagem',
    {
      p_triagem_id: id,
      p_turno: turno,
      p_observacao:
        safeString(payload?.observacao) || null,
      p_actor: authUser?.id || null,
    },
  );

  if (error) {
    throw httpError(
      error.message ||
        'Não foi possível gerar a matrícula.',
      400,
    );
  }

  const resultado =
    Array.isArray(data) && data.length > 0
      ? data[0]
      : data || {};

  const triagem = await obter(supabase, id);

  await auditLog(req, {
    action: 'MATRICULA_SAE_TRIAGEM',
    module: MODULE_NAME,
    entityType: 'sae_triagem',
    entityId: id,
    entityLabel: triagem.nome,
    description: `Protocolo ${
      triagem.protocoloMatricula || ''
    } emitido e matrícula criada por ${
      actor?.email ||
      authUser?.email ||
      'usuário autenticado'
    }.`,
    metadata: {
      usuarioId:
        safeString(resultado?.usuario_id) ||
        triagem.usuarioId,
      prontuario:
        safeString(resultado?.prontuario) ||
        null,
      protocolo:
        safeString(resultado?.protocolo) ||
        triagem.protocoloMatricula,
      turno,
    },
  });

  return {
    triagem,
    matricula: {
      usuarioId:
        safeString(resultado?.usuario_id) ||
        triagem.usuarioId,
      prontuario:
        safeString(resultado?.prontuario) ||
        null,
      protocolo:
        safeString(resultado?.protocolo) ||
        triagem.protocoloMatricula,
      matriculadoEm:
        safeString(resultado?.matriculado_em) ||
        triagem.matriculadoEm,
    },
  };
}

module.exports = {
  ETAPAS,
  listar,
  obter,
  criar,
  atualizarEtapa,
  decidir,
  matricular,
};
