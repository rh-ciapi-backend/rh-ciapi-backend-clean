const MODULE_NAME = 'sae_agenda';
const PERMISSION_MODULE = 'sae_profissionais';

function safeString(value) {
  return String(value ?? '').trim();
}

function createHttpError(message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function hasPermission(actor, actionName) {
  if (actor?.is_master) return true;

  const permission = (actor?.permissions || []).find(
    (item) => item.module === PERMISSION_MODULE,
  );

  return Boolean(
    permission?.allowed && (permission.actions || []).includes(actionName),
  );
}

function normalizeTime(value) {
  const raw = safeString(value);
  if (!raw) return null;

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return null;

  const [hour, minute] = normalized.split(':').map(Number);
  return hour * 60 + minute;
}

function normalizeDay(value) {
  const day = Number(value);

  if (!Number.isInteger(day) || day < 1 || day > 5) {
    throw createHttpError(
      'Dia da semana inválido. A agenda do SAE aceita somente segunda a sexta-feira.',
      400,
    );
  }

  return day;
}

function normalizeSlotDuration(value, fallback = 30) {
  const duration = value == null || value === '' ? fallback : Number(value);

  if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
    throw createHttpError(
      'A duração do slot deve estar entre 5 e 480 minutos.',
      400,
    );
  }

  return duration;
}

function validateTimeRange(startValue, endValue, label = 'horário') {
  const start = normalizeTime(startValue);
  const end = normalizeTime(endValue);

  if (!start || !end) {
    throw createHttpError(`Informe início e fim válidos para ${label}.`, 400);
  }

  if (timeToMinutes(end) <= timeToMinutes(start)) {
    throw createHttpError(`O fim de ${label} deve ser posterior ao início.`, 400);
  }

  return { start, end };
}

function normalizeOptionalInterval(startValue, endValue) {
  const startRaw = safeString(startValue);
  const endRaw = safeString(endValue);

  if (!startRaw && !endRaw) {
    return { start: null, end: null };
  }

  if (!startRaw || !endRaw) {
    throw createHttpError(
      'Para informar intervalo, preencha início e fim do intervalo.',
      400,
    );
  }

  const interval = validateTimeRange(startRaw, endRaw, 'o intervalo');
  return interval;
}

function normalizeAgenda(row) {
  return {
    id: safeString(row.id),
    profissionalId: safeString(row.profissional_id),
    servicoId: safeString(row.servico_id) || null,
    diaSemana: Number(row.dia_semana),
    horaInicio: safeString(row.hora_inicio) || null,
    horaFim: safeString(row.hora_fim) || null,
    intervaloInicio: safeString(row.intervalo_inicio) || null,
    intervaloFim: safeString(row.intervalo_fim) || null,
    duracaoSlotMinutos: Number(row.duracao_slot_minutos || 30),
    ativo: Boolean(row.ativo),
    observacao: safeString(row.observacao) || null,
    createdAt: row.created_at || null,
    createdBy: safeString(row.created_by) || null,
    updatedBy: safeString(row.updated_by) || null,
    updatedAt: row.updated_at || null,
  };
}

function normalizeRequestItem(row) {
  return {
    id: safeString(row.id),
    solicitacaoId: safeString(row.solicitacao_id),
    acao: safeString(row.acao),
    agendaProfissionalId: safeString(row.agenda_profissional_id) || null,
    servicoId: safeString(row.servico_id) || null,
    diaSemana: row.dia_semana == null ? null : Number(row.dia_semana),
    horaInicio: safeString(row.hora_inicio) || null,
    horaFim: safeString(row.hora_fim) || null,
    intervaloInicio: safeString(row.intervalo_inicio) || null,
    intervaloFim: safeString(row.intervalo_fim) || null,
    duracaoSlotMinutos:
      row.duracao_slot_minutos == null
        ? null
        : Number(row.duracao_slot_minutos),
    servicoIdAnterior: safeString(row.servico_id_anterior) || null,
    diaSemanaAnterior:
      row.dia_semana_anterior == null
        ? null
        : Number(row.dia_semana_anterior),
    horaInicioAnterior: safeString(row.hora_inicio_anterior) || null,
    horaFimAnterior: safeString(row.hora_fim_anterior) || null,
    intervaloInicioAnterior:
      safeString(row.intervalo_inicio_anterior) || null,
    intervaloFimAnterior: safeString(row.intervalo_fim_anterior) || null,
    duracaoSlotMinutosAnterior:
      row.duracao_slot_minutos_anterior == null
        ? null
        : Number(row.duracao_slot_minutos_anterior),
    observacao: safeString(row.observacao) || null,
    createdAt: row.created_at || null,
  };
}

function normalizeRequest(row, items = []) {
  return {
    id: safeString(row.id),
    profissionalId: safeString(row.profissional_id),
    tipoSolicitacao: safeString(row.tipo_solicitacao),
    status: safeString(row.status),
    justificativa: safeString(row.justificativa) || null,
    solicitadoPor: safeString(row.solicitado_por),
    analisadoPor: safeString(row.analisado_por) || null,
    analisadoEm: row.analisado_em || null,
    observacaoAnalise: safeString(row.observacao_analise) || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    itens: items,
  };
}

async function getProfessional(supabase, profissionalId) {
  const id = safeString(profissionalId);
  if (!id) throw createHttpError('Profissional inválido.', 400);

  const { data, error } = await supabase
    .from('sae_profissionais')
    .select('id,auth_user_id,nome,ativo')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError('Profissional não encontrado.', 404);

  return {
    id: safeString(data.id),
    authUserId: safeString(data.auth_user_id) || null,
    nome: safeString(data.nome),
    ativo: Boolean(data.ativo),
  };
}

async function getProfessionalByAuthUser(supabase, authUserId) {
  const id = safeString(authUserId);
  if (!id) return null;

  const { data, error } = await supabase
    .from('sae_profissionais')
    .select('id,auth_user_id,nome,ativo')
    .eq('auth_user_id', id)
    .limit(2);

  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) return null;

  if (rows.length > 1) {
    throw createHttpError(
      'Este usuário está vinculado a mais de um profissional. Revise o cadastro antes de usar a agenda.',
      409,
    );
  }

  const row = rows[0];
  return {
    id: safeString(row.id),
    authUserId: safeString(row.auth_user_id) || null,
    nome: safeString(row.nome),
    ativo: Boolean(row.ativo),
  };
}

async function validateServiceForProfessional(supabase, profissionalId, servicoId) {
  const id = safeString(servicoId);
  if (!id) return null;

  const { data, error } = await supabase
    .from('sae_profissional_servicos')
    .select('id,ativo')
    .eq('profissional_id', profissionalId)
    .eq('servico_id', id)
    .maybeSingle();

  if (error) throw error;

  if (!data || !data.ativo) {
    throw createHttpError(
      'O serviço informado não está vinculado ativamente a este profissional.',
      400,
    );
  }

  return id;
}

function rangesOverlap(startA, endA, startB, endB) {
  const a1 = timeToMinutes(startA);
  const a2 = timeToMinutes(endA);
  const b1 = timeToMinutes(startB);
  const b2 = timeToMinutes(endB);

  if ([a1, a2, b1, b2].some((value) => value == null)) return false;
  return a1 < b2 && b1 < a2;
}

async function assertNoOfficialOverlap(
  supabase,
  {
    profissionalId,
    diaSemana,
    horaInicio,
    horaFim,
    excludeAgendaId = null,
  },
) {
  let query = supabase
    .from('sae_agenda_profissionais')
    .select('id,dia_semana,hora_inicio,hora_fim,ativo')
    .eq('profissional_id', profissionalId)
    .eq('dia_semana', diaSemana)
    .eq('ativo', true);

  if (excludeAgendaId) {
    query = query.neq('id', excludeAgendaId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const conflict = (data || []).find((item) =>
    rangesOverlap(horaInicio, horaFim, item.hora_inicio, item.hora_fim),
  );

  if (conflict) {
    throw createHttpError(
      'O profissional já possui outro período oficial que se sobrepõe a este horário.',
      409,
      { agendaConflitanteId: safeString(conflict.id) },
    );
  }
}

function buildAgendaPayload(payload, profissionalId, authUserId, atual = null) {
  const diaSemana = normalizeDay(payload?.diaSemana ?? atual?.diaSemana);
  const range = validateTimeRange(
    payload?.horaInicio ?? atual?.horaInicio,
    payload?.horaFim ?? atual?.horaFim,
    'o horário de atendimento',
  );
  const interval = normalizeOptionalInterval(
    payload?.intervaloInicio ?? atual?.intervaloInicio,
    payload?.intervaloFim ?? atual?.intervaloFim,
  );

  if (
    interval.start &&
    (
      timeToMinutes(interval.start) < timeToMinutes(range.start) ||
      timeToMinutes(interval.end) > timeToMinutes(range.end)
    )
  ) {
    throw createHttpError(
      'O intervalo deve estar dentro do período de atendimento.',
      400,
    );
  }

  return {
    profissional_id: profissionalId,
    servico_id:
      payload?.servicoId === undefined
        ? atual?.servicoId || null
        : safeString(payload.servicoId) || null,
    dia_semana: diaSemana,
    hora_inicio: range.start,
    hora_fim: range.end,
    intervalo_inicio: interval.start,
    intervalo_fim: interval.end,
    duracao_slot_minutos: normalizeSlotDuration(
      payload?.duracaoSlotMinutos,
      atual?.duracaoSlotMinutos || 30,
    ),
    ativo:
      typeof payload?.ativo === 'boolean'
        ? payload.ativo
        : atual?.ativo !== false,
    observacao:
      payload?.observacao === undefined
        ? atual?.observacao || null
        : safeString(payload.observacao) || null,
    updated_at: new Date().toISOString(),
    updated_by: authUserId || null,
  };
}

async function listOfficialAgenda(supabase, profissionalId, options = {}) {
  const profissional = await getProfessional(supabase, profissionalId);

  let query = supabase
    .from('sae_agenda_profissionais')
    .select('*')
    .eq('profissional_id', profissional.id);

  if (options.includeInactive === false) {
    query = query.eq('ativo', true);
  }

  const { data, error } = await query
    .order('dia_semana', { ascending: true })
    .order('hora_inicio', { ascending: true });

  if (error) throw error;

  const { data: vinculos, error: vinculosError } = await supabase
    .from('sae_profissional_servicos')
    .select('servico_id,ativo')
    .eq('profissional_id', profissional.id)
    .eq('ativo', true);

  if (vinculosError) throw vinculosError;

  const servicoIds = (vinculos || [])
    .map((item) => safeString(item.servico_id))
    .filter(Boolean);

  let servicos = [];

  if (servicoIds.length > 0) {
    const { data: servicosData, error: servicosError } = await supabase
      .from('sae_servicos')
      .select('id,nome,sigla,ativo')
      .in('id', servicoIds)
      .eq('ativo', true)
      .order('nome', { ascending: true });

    if (servicosError) throw servicosError;

    servicos = (servicosData || []).map((item) => ({
      id: safeString(item.id),
      nome: safeString(item.nome),
      sigla: safeString(item.sigla) || null,
      ativo: Boolean(item.ativo),
    }));
  }

  return {
    profissional,
    agenda: (data || []).map(normalizeAgenda),
    servicos,
  };
}

async function getAgendaById(supabase, agendaId) {
  const id = safeString(agendaId);
  if (!id) throw createHttpError('Agenda inválida.', 400);

  const { data, error } = await supabase
    .from('sae_agenda_profissionais')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError('Agenda oficial não encontrada.', 404);

  return normalizeAgenda(data);
}

async function createOfficialAgenda({
  supabase,
  authUser,
  actor,
  auditLog,
  profissionalId,
  payload,
  req,
}) {
  const profissional = await getProfessional(supabase, profissionalId);
  const agendaPayload = buildAgendaPayload(
    payload,
    profissional.id,
    authUser?.id,
  );

  await validateServiceForProfessional(
    supabase,
    profissional.id,
    agendaPayload.servico_id,
  );

  await assertNoOfficialOverlap(supabase, {
    profissionalId: profissional.id,
    diaSemana: agendaPayload.dia_semana,
    horaInicio: agendaPayload.hora_inicio,
    horaFim: agendaPayload.hora_fim,
  });

  const { data, error } = await supabase
    .from('sae_agenda_profissionais')
    .insert({
      ...agendaPayload,
      created_by: authUser?.id || null,
    })
    .select('*')
    .single();

  if (error) throw error;

  const agenda = normalizeAgenda(data);

  await auditLog(req, {
    action: 'CREATE_SAE_AGENDA_OFICIAL',
    module: MODULE_NAME,
    entityType: 'sae_agenda_profissional',
    entityId: agenda.id,
    entityLabel: profissional.nome,
    description: `Agenda oficial de ${profissional.nome} criada por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: { agenda },
  });

  return agenda;
}

function dateToWeekday(dateString) {
  const date = safeString(dateString);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getUTCDay();
}

function isCancelledStatus(value) {
  return safeString(value).toUpperCase().includes('CANCEL');
}

async function enrichImpactsWithUsers(supabase, impacts) {
  const userIds = Array.from(
    new Set(
      impacts
        .map((item) => safeString(item.usuarioId))
        .filter(Boolean),
    ),
  );

  if (userIds.length === 0) return impacts;

  const { data, error } = await supabase
    .from('sae_usuarios_resumo')
    .select('id,prontuario,nome,telefone_principal')
    .in('id', userIds);

  if (error) throw error;

  const usersMap = new Map(
    (data || []).map((item) => [safeString(item.id), item]),
  );

  return impacts.map((item) => {
    const user = usersMap.get(safeString(item.usuarioId));

    return {
      ...item,
      nome:
        safeString(user?.nome) || safeString(item.nomeAvulso) || 'Não informado',
      prontuario:
        safeString(user?.prontuario) ||
        safeString(item.prontuarioInformado) ||
        null,
      telefone: safeString(user?.telefone_principal) || null,
    };
  });
}

async function findImpactedAppointments(supabase, agenda) {
  const today = new Date().toISOString().slice(0, 10);

  const { data: serviceRows, error: serviceError } = await supabase
    .from('sae_agendamento_servicos')
    .select(
      'id,agendamento_id,servico_id,profissional_id,turno,hora_inicio,hora_fim,status,observacao',
    )
    .eq('profissional_id', agenda.profissionalId)
    .not('hora_inicio', 'is', null);

  if (serviceError) throw serviceError;

  const rows = (serviceRows || []).filter((row) => {
    if (isCancelledStatus(row.status)) return false;
    if (agenda.servicoId && safeString(row.servico_id) !== agenda.servicoId) {
      return false;
    }
    return true;
  });

  const appointmentIds = Array.from(
    new Set(rows.map((row) => safeString(row.agendamento_id)).filter(Boolean)),
  );

  if (appointmentIds.length === 0) return [];

  const { data: appointments, error: appointmentsError } = await supabase
    .from('sae_agendamentos')
    .select(
      'id,data,tipo_usuario,usuario_id,prontuario_informado,nome_avulso,tipo_atendimento,status,observacao',
    )
    .in('id', appointmentIds)
    .gte('data', today);

  if (appointmentsError) throw appointmentsError;

  const appointmentMap = new Map(
    (appointments || []).map((item) => [safeString(item.id), item]),
  );

  const agendaStart = timeToMinutes(agenda.horaInicio);
  const agendaEnd = timeToMinutes(agenda.horaFim);

  const impacts = [];

  for (const row of rows) {
    const appointment = appointmentMap.get(safeString(row.agendamento_id));
    if (!appointment) continue;
    if (isCancelledStatus(appointment.status)) continue;

    const weekday = dateToWeekday(appointment.data);
    if (weekday !== agenda.diaSemana) continue;

    const start = timeToMinutes(row.hora_inicio);
    const end = timeToMinutes(row.hora_fim) ?? (start == null ? null : start + 1);

    if (start == null) continue;

    const intersects =
      agendaStart != null &&
      agendaEnd != null &&
      start < agendaEnd &&
      (end == null || end > agendaStart);

    if (!intersects) continue;

    impacts.push({
      agendamentoServicoId: safeString(row.id),
      agendamentoId: safeString(appointment.id),
      data: safeString(appointment.data),
      tipoUsuario: safeString(appointment.tipo_usuario),
      usuarioId: safeString(appointment.usuario_id) || null,
      prontuarioInformado:
        safeString(appointment.prontuario_informado) || null,
      nomeAvulso: safeString(appointment.nome_avulso) || null,
      tipoAtendimento: safeString(appointment.tipo_atendimento) || null,
      servicoId: safeString(row.servico_id) || null,
      turno: safeString(row.turno) || null,
      horaInicio: safeString(row.hora_inicio) || null,
      horaFim: safeString(row.hora_fim) || null,
      statusAgendamento: safeString(appointment.status),
      statusServico: safeString(row.status),
    });
  }

  const enriched = await enrichImpactsWithUsers(supabase, impacts);

  return enriched.sort((a, b) => {
    const dateCompare = safeString(a.data).localeCompare(safeString(b.data));
    if (dateCompare !== 0) return dateCompare;
    return safeString(a.horaInicio).localeCompare(safeString(b.horaInicio));
  });
}

async function getAgendaImpact(supabase, agendaId) {
  const agenda = await getAgendaById(supabase, agendaId);
  const afetados = await findImpactedAppointments(supabase, agenda);

  return {
    agenda,
    totalAfetados: afetados.length,
    afetados,
  };
}

function requireImpactAcknowledgement(impact, payload) {
  if (impact.totalAfetados > 0 && payload?.confirmarImpacto !== true) {
    throw createHttpError(
      `A alteração afeta ${impact.totalAfetados} agendamento(s). Confirme que a secretaria está ciente antes de continuar.`,
      409,
      impact,
    );
  }
}

async function updateOfficialAgenda({
  supabase,
  authUser,
  actor,
  auditLog,
  agendaId,
  payload,
  req,
}) {
  const atual = await getAgendaById(supabase, agendaId);
  const profissional = await getProfessional(supabase, atual.profissionalId);
  const impact = await getAgendaImpact(supabase, atual.id);

  requireImpactAcknowledgement(impact, payload);

  const updatePayload = buildAgendaPayload(
    payload,
    atual.profissionalId,
    authUser?.id,
    atual,
  );

  await validateServiceForProfessional(
    supabase,
    atual.profissionalId,
    updatePayload.servico_id,
  );

  await assertNoOfficialOverlap(supabase, {
    profissionalId: atual.profissionalId,
    diaSemana: updatePayload.dia_semana,
    horaInicio: updatePayload.hora_inicio,
    horaFim: updatePayload.hora_fim,
    excludeAgendaId: atual.id,
  });

  const { data, error } = await supabase
    .from('sae_agenda_profissionais')
    .update(updatePayload)
    .eq('id', atual.id)
    .select('*')
    .single();

  if (error) throw error;

  const agenda = normalizeAgenda(data);

  await auditLog(req, {
    action: 'UPDATE_SAE_AGENDA_OFICIAL',
    module: MODULE_NAME,
    entityType: 'sae_agenda_profissional',
    entityId: agenda.id,
    entityLabel: profissional.nome,
    description: `Agenda oficial de ${profissional.nome} atualizada por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: {
      anterior: atual,
      atual: agenda,
      total_agendamentos_afetados: impact.totalAfetados,
      impacto_confirmado: payload?.confirmarImpacto === true,
      motivo_alteracao: safeString(payload?.motivoAlteracao) || null,
    },
  });

  return { agenda, impacto: impact };
}

async function deleteOfficialAgenda({
  supabase,
  authUser,
  actor,
  auditLog,
  agendaId,
  payload,
  req,
}) {
  const atual = await getAgendaById(supabase, agendaId);
  const profissional = await getProfessional(supabase, atual.profissionalId);
  const impact = await getAgendaImpact(supabase, atual.id);

  requireImpactAcknowledgement(impact, payload);

  if (!atual.ativo) {
    throw createHttpError('Este período da agenda já está inativo.', 409);
  }

  const { error } = await supabase
    .from('sae_agenda_profissionais')
    .update({
      ativo: false,
      updated_at: new Date().toISOString(),
      updated_by: authUser?.id || null,
    })
    .eq('id', atual.id);

  if (error) throw error;

  await auditLog(req, {
    action: 'INACTIVATE_SAE_AGENDA_OFICIAL',
    module: MODULE_NAME,
    entityType: 'sae_agenda_profissional',
    entityId: atual.id,
    entityLabel: profissional.nome,
    description: `Período da agenda oficial de ${profissional.nome} inativado por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: {
      agenda_removida: atual,
      total_agendamentos_afetados: impact.totalAfetados,
      impacto_confirmado: payload?.confirmarImpacto === true,
      motivo_alteracao: safeString(payload?.motivoAlteracao) || null,
    },
  });

  return { ok: true, impacto: impact };
}

async function assertCanRequestForProfessional({
  supabase,
  authUser,
  actor,
  profissionalId,
}) {
  const profissional = await getProfessional(supabase, profissionalId);

  if (hasPermission(actor, 'editar')) {
    return profissional;
  }

  if (!authUser?.id || profissional.authUserId !== authUser.id) {
    throw createHttpError(
      'Você não pode criar solicitações para este profissional.',
      403,
    );
  }

  return profissional;
}

async function buildRequestItems({ supabase, profissionalId, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError('Informe pelo menos um item na solicitação.', 400);
  }

  const result = [];

  for (const raw of items) {
    const action = safeString(raw?.acao).toUpperCase();

    if (!['INCLUIR', 'ALTERAR', 'REMOVER'].includes(action)) {
      throw createHttpError('Ação inválida em um item da solicitação.', 400);
    }

    let currentAgenda = null;

    if (action !== 'INCLUIR') {
      currentAgenda = await getAgendaById(supabase, raw?.agendaProfissionalId);

      if (currentAgenda.profissionalId !== profissionalId) {
        throw createHttpError(
          'A agenda informada não pertence ao profissional da solicitação.',
          400,
        );
      }
    }

    if (action === 'REMOVER') {
      result.push({
        acao: action,
        agenda_profissional_id: currentAgenda.id,
        servico_id: null,
        dia_semana: null,
        hora_inicio: null,
        hora_fim: null,
        intervalo_inicio: null,
        intervalo_fim: null,
        duracao_slot_minutos: null,
        servico_id_anterior: currentAgenda.servicoId,
        dia_semana_anterior: currentAgenda.diaSemana,
        hora_inicio_anterior: currentAgenda.horaInicio,
        hora_fim_anterior: currentAgenda.horaFim,
        intervalo_inicio_anterior: currentAgenda.intervaloInicio,
        intervalo_fim_anterior: currentAgenda.intervaloFim,
        duracao_slot_minutos_anterior: currentAgenda.duracaoSlotMinutos,
        observacao: safeString(raw?.observacao) || null,
      });
      continue;
    }

    const newAgendaPayload = buildAgendaPayload(
      raw,
      profissionalId,
      null,
      currentAgenda,
    );

    await validateServiceForProfessional(
      supabase,
      profissionalId,
      newAgendaPayload.servico_id,
    );

    result.push({
      acao: action,
      agenda_profissional_id: currentAgenda?.id || null,
      servico_id: newAgendaPayload.servico_id,
      dia_semana: newAgendaPayload.dia_semana,
      hora_inicio: newAgendaPayload.hora_inicio,
      hora_fim: newAgendaPayload.hora_fim,
      intervalo_inicio: newAgendaPayload.intervalo_inicio,
      intervalo_fim: newAgendaPayload.intervalo_fim,
      duracao_slot_minutos: newAgendaPayload.duracao_slot_minutos,
      servico_id_anterior: currentAgenda?.servicoId || null,
      dia_semana_anterior: currentAgenda?.diaSemana || null,
      hora_inicio_anterior: currentAgenda?.horaInicio || null,
      hora_fim_anterior: currentAgenda?.horaFim || null,
      intervalo_inicio_anterior: currentAgenda?.intervaloInicio || null,
      intervalo_fim_anterior: currentAgenda?.intervaloFim || null,
      duracao_slot_minutos_anterior:
        currentAgenda?.duracaoSlotMinutos || null,
      observacao: safeString(raw?.observacao) || null,
    });
  }

  return result;
}

function inferRequestType(items) {
  const actions = Array.from(new Set(items.map((item) => item.acao)));
  return actions.length === 1 ? actions[0] : 'MISTA';
}

async function createScheduleRequest({
  supabase,
  authUser,
  actor,
  auditLog,
  payload,
  req,
}) {
  const profissionalId = safeString(payload?.profissionalId);
  const profissional = await assertCanRequestForProfessional({
    supabase,
    authUser,
    actor,
    profissionalId,
  });

  const justificativa = safeString(payload?.justificativa);
  if (!justificativa) {
    throw createHttpError('Informe a justificativa da solicitação.', 400);
  }

  const items = await buildRequestItems({
    supabase,
    profissionalId: profissional.id,
    items: payload?.itens,
  });

  const { data: requestRow, error: requestError } = await supabase
    .from('sae_solicitacoes_agenda')
    .insert({
      profissional_id: profissional.id,
      tipo_solicitacao: inferRequestType(items),
      status: 'PENDENTE',
      justificativa,
      solicitado_por: authUser.id,
    })
    .select('*')
    .single();

  if (requestError) throw requestError;

  const itemsPayload = items.map((item) => ({
    solicitacao_id: requestRow.id,
    ...item,
  }));

  const { data: itemRows, error: itemsError } = await supabase
    .from('sae_solicitacao_agenda_itens')
    .insert(itemsPayload)
    .select('*');

  if (itemsError) {
    await supabase
      .from('sae_solicitacoes_agenda')
      .delete()
      .eq('id', requestRow.id);
    throw itemsError;
  }

  const request = normalizeRequest(
    requestRow,
    (itemRows || []).map(normalizeRequestItem),
  );

  await auditLog(req, {
    action: 'CREATE_SAE_AGENDA_SOLICITACAO',
    module: MODULE_NAME,
    entityType: 'sae_solicitacao_agenda',
    entityId: request.id,
    entityLabel: profissional.nome,
    description: `Solicitação de agenda de ${profissional.nome} criada por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: {
      tipo: request.tipoSolicitacao,
      itens: request.itens,
    },
  });

  return request;
}

async function getRequestById(supabase, requestId) {
  const id = safeString(requestId);
  if (!id) throw createHttpError('Solicitação inválida.', 400);

  const [requestResponse, itemsResponse] = await Promise.all([
    supabase
      .from('sae_solicitacoes_agenda')
      .select('*')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('sae_solicitacao_agenda_itens')
      .select('*')
      .eq('solicitacao_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (requestResponse.error) throw requestResponse.error;
  if (itemsResponse.error) throw itemsResponse.error;
  if (!requestResponse.data) {
    throw createHttpError('Solicitação não encontrada.', 404);
  }

  return normalizeRequest(
    requestResponse.data,
    (itemsResponse.data || []).map(normalizeRequestItem),
  );
}

async function listScheduleRequests(supabase, filters = {}) {
  let query = supabase
    .from('sae_solicitacoes_agenda')
    .select('*')
    .order('created_at', { ascending: false });

  if (safeString(filters.status)) {
    query = query.eq('status', safeString(filters.status).toUpperCase());
  }

  if (safeString(filters.profissionalId)) {
    query = query.eq('profissional_id', safeString(filters.profissionalId));
  }

  const { data, error } = await query;
  if (error) throw error;

  const requests = data || [];
  const requestIds = requests.map((item) => safeString(item.id));

  let items = [];
  if (requestIds.length > 0) {
    const { data: itemData, error: itemError } = await supabase
      .from('sae_solicitacao_agenda_itens')
      .select('*')
      .in('solicitacao_id', requestIds)
      .order('created_at', { ascending: true });

    if (itemError) throw itemError;
    items = itemData || [];
  }

  const itemsMap = new Map();
  for (const item of items) {
    const requestId = safeString(item.solicitacao_id);
    const list = itemsMap.get(requestId) || [];
    list.push(normalizeRequestItem(item));
    itemsMap.set(requestId, list);
  }

  const professionalIds = Array.from(
    new Set(requests.map((item) => safeString(item.profissional_id)).filter(Boolean)),
  );

  let professionalsMap = new Map();
  if (professionalIds.length > 0) {
    const { data: professionals, error: professionalsError } = await supabase
      .from('sae_profissionais')
      .select('id,nome')
      .in('id', professionalIds);

    if (professionalsError) throw professionalsError;

    professionalsMap = new Map(
      (professionals || []).map((item) => [safeString(item.id), safeString(item.nome)]),
    );
  }

  return requests.map((row) => ({
    ...normalizeRequest(row, itemsMap.get(safeString(row.id)) || []),
    profissionalNome: professionalsMap.get(safeString(row.profissional_id)) || null,
  }));
}

async function listMyScheduleRequests(supabase, authUserId) {
  const profissional = await getProfessionalByAuthUser(supabase, authUserId);

  if (!profissional) {
    return { profissional: null, solicitacoes: [] };
  }

  const solicitacoes = await listScheduleRequests(supabase, {
    profissionalId: profissional.id,
  });

  return { profissional, solicitacoes };
}

async function cancelScheduleRequest({
  supabase,
  authUser,
  actor,
  auditLog,
  requestId,
  req,
}) {
  const request = await getRequestById(supabase, requestId);

  if (request.status !== 'PENDENTE') {
    throw createHttpError(
      'Somente solicitações pendentes podem ser canceladas.',
      409,
    );
  }

  const profissional = await getProfessional(supabase, request.profissionalId);
  const isOwner =
    authUser?.id &&
    profissional.authUserId &&
    profissional.authUserId === authUser.id;

  if (!isOwner && !hasPermission(actor, 'editar')) {
    throw createHttpError('Você não pode cancelar esta solicitação.', 403);
  }

  const { error } = await supabase
    .from('sae_solicitacoes_agenda')
    .update({
      status: 'CANCELADA',
      updated_at: new Date().toISOString(),
    })
    .eq('id', request.id);

  if (error) throw error;

  await auditLog(req, {
    action: 'CANCEL_SAE_AGENDA_SOLICITACAO',
    module: MODULE_NAME,
    entityType: 'sae_solicitacao_agenda',
    entityId: request.id,
    entityLabel: profissional.nome,
    description: `Solicitação de agenda de ${profissional.nome} cancelada por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: {},
  });

  return getRequestById(supabase, request.id);
}

async function collectRequestImpacts(supabase, request) {
  const impactsByAgenda = [];
  const uniqueMap = new Map();

  for (const item of request.itens) {
    if (!['ALTERAR', 'REMOVER'].includes(item.acao)) continue;
    if (!item.agendaProfissionalId) continue;

    const impact = await getAgendaImpact(supabase, item.agendaProfissionalId);
    impactsByAgenda.push(impact);

    for (const affected of impact.afetados) {
      const key = affected.agendamentoServicoId;
      if (!uniqueMap.has(key)) uniqueMap.set(key, affected);
    }
  }

  return {
    totalAfetados: uniqueMap.size,
    afetados: Array.from(uniqueMap.values()),
    porAgenda: impactsByAgenda,
  };
}

async function validateRequestApplication(supabase, request) {
  const { data: officialRows, error: officialError } = await supabase
    .from('sae_agenda_profissionais')
    .select('*')
    .eq('profissional_id', request.profissionalId);

  if (officialError) throw officialError;

  const simulated = new Map(
    (officialRows || []).map((row) => {
      const agenda = normalizeAgenda(row);
      return [agenda.id, agenda];
    }),
  );

  let temporaryIndex = 0;

  for (const item of request.itens) {
    if (item.acao === 'REMOVER') {
      const current = simulated.get(item.agendaProfissionalId);
      if (!current) {
        throw createHttpError(
          'Uma agenda que seria removida não existe mais.',
          409,
        );
      }

      simulated.set(current.id, { ...current, ativo: false });
      continue;
    }

    await validateServiceForProfessional(
      supabase,
      request.profissionalId,
      item.servicoId,
    );

    const candidate = {
      id:
        item.acao === 'ALTERAR'
          ? item.agendaProfissionalId
          : `__novo_${temporaryIndex++}`,
      profissionalId: request.profissionalId,
      servicoId: item.servicoId,
      diaSemana: normalizeDay(item.diaSemana),
      horaInicio: validateTimeRange(
        item.horaInicio,
        item.horaFim,
        'o horário solicitado',
      ).start,
      horaFim: normalizeTime(item.horaFim),
      intervaloInicio: item.intervaloInicio,
      intervaloFim: item.intervaloFim,
      duracaoSlotMinutos: normalizeSlotDuration(
        item.duracaoSlotMinutos,
        30,
      ),
      ativo: true,
      observacao: item.observacao,
    };

    if (item.acao === 'ALTERAR' && !simulated.has(candidate.id)) {
      throw createHttpError(
        'Uma agenda que seria alterada não existe mais.',
        409,
      );
    }

    simulated.set(candidate.id, candidate);
  }

  const active = Array.from(simulated.values()).filter((item) => item.ativo);

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];

      if (a.diaSemana !== b.diaSemana) continue;

      if (rangesOverlap(a.horaInicio, a.horaFim, b.horaInicio, b.horaFim)) {
        throw createHttpError(
          'A solicitação produziria horários oficiais sobrepostos para o mesmo profissional.',
          409,
          { agendaA: a.id, agendaB: b.id },
        );
      }
    }
  }
}

async function applyRequestItems({ supabase, authUserId, request }) {
  const rollbackSteps = [];

  try {
    for (const item of request.itens) {
      if (item.acao === 'INCLUIR') {
        const { data, error } = await supabase
          .from('sae_agenda_profissionais')
          .insert({
            profissional_id: request.profissionalId,
            servico_id: item.servicoId,
            dia_semana: item.diaSemana,
            hora_inicio: item.horaInicio,
            hora_fim: item.horaFim,
            intervalo_inicio: item.intervaloInicio,
            intervalo_fim: item.intervaloFim,
            duracao_slot_minutos: item.duracaoSlotMinutos || 30,
            ativo: true,
            observacao: item.observacao,
            created_by: authUserId || null,
            updated_by: authUserId || null,
          })
          .select('*')
          .single();

        if (error) throw error;

        rollbackSteps.push(async () => {
          await supabase
            .from('sae_agenda_profissionais')
            .delete()
            .eq('id', data.id);
        });
        continue;
      }

      const current = await getAgendaById(supabase, item.agendaProfissionalId);

      if (item.acao === 'ALTERAR') {
        const { error } = await supabase
          .from('sae_agenda_profissionais')
          .update({
            servico_id: item.servicoId,
            dia_semana: item.diaSemana,
            hora_inicio: item.horaInicio,
            hora_fim: item.horaFim,
            intervalo_inicio: item.intervaloInicio,
            intervalo_fim: item.intervaloFim,
            duracao_slot_minutos: item.duracaoSlotMinutos || 30,
            observacao: item.observacao,
            updated_at: new Date().toISOString(),
            updated_by: authUserId || null,
          })
          .eq('id', current.id);

        if (error) throw error;

        rollbackSteps.push(async () => {
          await supabase
            .from('sae_agenda_profissionais')
            .update({
              servico_id: current.servicoId,
              dia_semana: current.diaSemana,
              hora_inicio: current.horaInicio,
              hora_fim: current.horaFim,
              intervalo_inicio: current.intervaloInicio,
              intervalo_fim: current.intervaloFim,
              duracao_slot_minutos: current.duracaoSlotMinutos,
              ativo: current.ativo,
              observacao: current.observacao,
              updated_at: new Date().toISOString(),
              updated_by: authUserId || null,
            })
            .eq('id', current.id);
        });
        continue;
      }

      if (item.acao === 'REMOVER') {
        const { error } = await supabase
          .from('sae_agenda_profissionais')
          .update({
            ativo: false,
            updated_at: new Date().toISOString(),
            updated_by: authUserId || null,
          })
          .eq('id', current.id);

        if (error) throw error;

        rollbackSteps.push(async () => {
          await supabase
            .from('sae_agenda_profissionais')
            .update({
              ativo: current.ativo,
              updated_at: current.updatedAt || new Date().toISOString(),
              updated_by: current.updatedBy || null,
            })
            .eq('id', current.id);
        });
      }
    }

    return async () => {
      for (const rollback of rollbackSteps.reverse()) {
        try {
          await rollback();
        } catch (rollbackError) {
          console.error('[saeAgendaService] Falha no rollback:', rollbackError);
        }
      }
    };
  } catch (error) {
    for (const rollback of rollbackSteps.reverse()) {
      try {
        await rollback();
      } catch (rollbackError) {
        console.error('[saeAgendaService] Falha no rollback:', rollbackError);
      }
    }
    throw error;
  }
}

async function analyzeScheduleRequest({
  supabase,
  authUser,
  actor,
  auditLog,
  requestId,
  payload,
  req,
}) {
  const decision = safeString(payload?.decisao).toUpperCase();

  if (!['APROVADA', 'RECUSADA'].includes(decision)) {
    throw createHttpError('Decisão inválida para a solicitação.', 400);
  }

  const request = await getRequestById(supabase, requestId);

  if (request.status !== 'PENDENTE') {
    throw createHttpError(
      'Esta solicitação já foi analisada ou cancelada.',
      409,
    );
  }

  const profissional = await getProfessional(supabase, request.profissionalId);
  let impact = { totalAfetados: 0, afetados: [], porAgenda: [] };
  let rollbackAgenda = null;

  if (decision === 'APROVADA') {
    impact = await collectRequestImpacts(supabase, request);

    if (impact.totalAfetados > 0 && payload?.confirmarImpacto !== true) {
      throw createHttpError(
        `A aprovação afeta ${impact.totalAfetados} agendamento(s). A secretaria deve confirmar ciência antes de aplicar a mudança.`,
        409,
        impact,
      );
    }

    await validateRequestApplication(supabase, request);

    rollbackAgenda = await applyRequestItems({
      supabase,
      authUserId: authUser?.id,
      request,
    });
  }

  const analysisPayload = {
    status: decision,
    analisado_por: authUser?.id || null,
    analisado_em: new Date().toISOString(),
    observacao_analise: safeString(payload?.observacaoAnalise) || null,
    updated_at: new Date().toISOString(),
  };

  const { data: updatedRequest, error: updateError } = await supabase
    .from('sae_solicitacoes_agenda')
    .update(analysisPayload)
    .eq('id', request.id)
    .eq('status', 'PENDENTE')
    .select('id')
    .maybeSingle();

  if (updateError || !updatedRequest) {
    if (rollbackAgenda) await rollbackAgenda();
    if (updateError) throw updateError;
    throw createHttpError(
      'A solicitação foi alterada por outro usuário durante a análise. Atualize a página e tente novamente.',
      409,
    );
  }

  const analyzed = await getRequestById(supabase, request.id);

  await auditLog(req, {
    action:
      decision === 'APROVADA'
        ? 'APPROVE_SAE_AGENDA_SOLICITACAO'
        : 'REJECT_SAE_AGENDA_SOLICITACAO',
    module: MODULE_NAME,
    entityType: 'sae_solicitacao_agenda',
    entityId: request.id,
    entityLabel: profissional.nome,
    description: `Solicitação de agenda de ${profissional.nome} ${decision === 'APROVADA' ? 'aprovada' : 'recusada'} por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
    metadata: {
      decisao: decision,
      observacao_analise: safeString(payload?.observacaoAnalise) || null,
      total_agendamentos_afetados: impact.totalAfetados,
      impacto_confirmado: payload?.confirmarImpacto === true,
    },
  });

  return { solicitacao: analyzed, impacto: impact };
}

module.exports = {
  listOfficialAgenda,
  getAgendaImpact,
  createOfficialAgenda,
  updateOfficialAgenda,
  deleteOfficialAgenda,
  createScheduleRequest,
  listScheduleRequests,
  listMyScheduleRequests,
  cancelScheduleRequest,
  analyzeScheduleRequest,
  getProfessionalByAuthUser,
};
