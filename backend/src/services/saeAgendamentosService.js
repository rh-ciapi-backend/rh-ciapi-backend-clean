const MODULE_NAME = 'sae_agendamentos';
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

function minutesToTime(value) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function rangesOverlap(startA, endA, startB, endB) {
  const a1 = timeToMinutes(startA);
  const a2 = timeToMinutes(endA);
  const b1 = timeToMinutes(startB);
  const b2 = timeToMinutes(endB);

  if ([a1, a2, b1, b2].some((value) => value == null)) return false;
  return a1 < b2 && b1 < a2;
}

function normalizeDate(value) {
  const raw = safeString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw createHttpError('Informe uma data válida no formato AAAA-MM-DD.', 400);
  }

  const parsed = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError('Data inválida.', 400);
  }

  return raw;
}

function dateToWeekday(dateString) {
  const parsed = new Date(`${dateString}T12:00:00Z`);
  return parsed.getUTCDay();
}

function isCancelledStatus(value) {
  return safeString(value).toUpperCase().includes('CANCEL');
}

function determineTurno(horaInicio) {
  const minutes = timeToMinutes(horaInicio);
  if (minutes == null) return null;
  return minutes < 12 * 60 ? 'MANHÃ' : 'TARDE';
}

async function getProfessional(supabase, profissionalId) {
  const id = safeString(profissionalId);
  if (!id) throw createHttpError('Profissional inválido.', 400);

  const { data, error } = await supabase
    .from('sae_profissionais')
    .select('id,nome,ativo')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError('Profissional não encontrado.', 404);
  if (!data.ativo) throw createHttpError('O profissional selecionado está inativo.', 409);

  return {
    id: safeString(data.id),
    nome: safeString(data.nome),
    ativo: Boolean(data.ativo),
  };
}

async function getService(supabase, servicoId) {
  const id = safeString(servicoId);
  if (!id) throw createHttpError('Serviço inválido.', 400);

  const { data, error } = await supabase
    .from('sae_servicos')
    .select('id,nome,sigla,ativo')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError('Serviço não encontrado.', 404);
  if (!data.ativo) throw createHttpError('O serviço selecionado está inativo.', 409);

  return {
    id: safeString(data.id),
    nome: safeString(data.nome),
    sigla: safeString(data.sigla) || null,
    ativo: Boolean(data.ativo),
  };
}

async function assertProfessionalServiceLink(supabase, profissionalId, servicoId) {
  const { data, error } = await supabase
    .from('sae_profissional_servicos')
    .select('id,ativo')
    .eq('profissional_id', profissionalId)
    .eq('servico_id', servicoId)
    .maybeSingle();

  if (error) throw error;

  if (!data || !data.ativo) {
    throw createHttpError(
      'O serviço selecionado não está vinculado ativamente a este profissional.',
      409,
    );
  }
}

async function listarCatalogo(supabase) {
  const [servicosResponse, profissionaisResponse, vinculosResponse] = await Promise.all([
    supabase
      .from('sae_servicos')
      .select('id,nome,sigla,ativo')
      .eq('ativo', true)
      .order('nome', { ascending: true }),
    supabase
      .from('sae_profissionais')
      .select('id,nome,ativo')
      .eq('ativo', true)
      .order('nome', { ascending: true }),
    supabase
      .from('sae_profissional_servicos')
      .select('profissional_id,servico_id,ativo')
      .eq('ativo', true),
  ]);

  if (servicosResponse.error) throw servicosResponse.error;
  if (profissionaisResponse.error) throw profissionaisResponse.error;
  if (vinculosResponse.error) throw vinculosResponse.error;

  const servicos = (servicosResponse.data || []).map((item) => ({
    id: safeString(item.id),
    nome: safeString(item.nome),
    sigla: safeString(item.sigla) || null,
  }));

  const vinculosPorProfissional = new Map();

  for (const vinculo of vinculosResponse.data || []) {
    const profissionalId = safeString(vinculo.profissional_id);
    const servicoId = safeString(vinculo.servico_id);
    const atual = vinculosPorProfissional.get(profissionalId) || [];
    atual.push(servicoId);
    vinculosPorProfissional.set(profissionalId, atual);
  }

  const profissionais = (profissionaisResponse.data || []).map((item) => ({
    id: safeString(item.id),
    nome: safeString(item.nome),
    servicoIds: vinculosPorProfissional.get(safeString(item.id)) || [],
  }));

  return { servicos, profissionais };
}

async function buscarUsuarios(supabase, busca, limit = 20) {
  const termo = safeString(busca);
  if (termo.length < 2) {
    return { usuarios: [] };
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));

  const { data, error } = await supabase
    .from('sae_usuarios_resumo')
    .select('id,prontuario,nome')
    .or(`nome.ilike.%${termo}%,prontuario.ilike.%${termo}%`)
    .order('nome', { ascending: true })
    .limit(safeLimit);

  if (error) throw error;

  return {
    usuarios: (data || []).map((item) => ({
      id: safeString(item.id),
      prontuario: safeString(item.prontuario),
      nome: safeString(item.nome),
    })),
  };
}

async function getAgendaPeriodsForDate(supabase, profissionalId, servicoId, data) {
  const weekday = dateToWeekday(data);

  if (weekday < 1 || weekday > 5) {
    return [];
  }

  const { data: rows, error } = await supabase
    .from('sae_agenda_profissionais')
    .select(
      'id,profissional_id,servico_id,dia_semana,hora_inicio,hora_fim,intervalo_inicio,intervalo_fim,duracao_slot_minutos,ativo',
    )
    .eq('profissional_id', profissionalId)
    .eq('dia_semana', weekday)
    .eq('ativo', true)
    .order('hora_inicio', { ascending: true });

  if (error) throw error;

  return (rows || []).filter((item) => {
    const agendaServicoId = safeString(item.servico_id);
    return !agendaServicoId || agendaServicoId === servicoId;
  });
}

async function getOccupiedIntervals(supabase, profissionalId, data) {
  const { data: serviceRows, error: serviceError } = await supabase
    .from('sae_agendamento_servicos')
    .select('id,agendamento_id,hora_inicio,hora_fim,status')
    .eq('profissional_id', profissionalId)
    .not('hora_inicio', 'is', null);

  if (serviceError) throw serviceError;

  const activeRows = (serviceRows || []).filter((item) => !isCancelledStatus(item.status));
  const appointmentIds = Array.from(
    new Set(activeRows.map((item) => safeString(item.agendamento_id)).filter(Boolean)),
  );

  if (appointmentIds.length === 0) return [];

  const { data: appointments, error: appointmentError } = await supabase
    .from('sae_agendamentos')
    .select('id,data,status')
    .in('id', appointmentIds)
    .eq('data', data);

  if (appointmentError) throw appointmentError;

  const validAppointmentIds = new Set(
    (appointments || [])
      .filter((item) => !isCancelledStatus(item.status))
      .map((item) => safeString(item.id)),
  );

  return activeRows
    .filter((item) => validAppointmentIds.has(safeString(item.agendamento_id)))
    .map((item) => ({
      horaInicio: safeString(item.hora_inicio),
      horaFim: safeString(item.hora_fim) || safeString(item.hora_inicio),
    }))
    .filter((item) => item.horaInicio);
}

async function consultarDisponibilidade(supabase, params) {
  const profissionalId = safeString(params?.profissionalId);
  const servicoId = safeString(params?.servicoId);
  const data = normalizeDate(params?.data);

  const [profissional, servico] = await Promise.all([
    getProfessional(supabase, profissionalId),
    getService(supabase, servicoId),
  ]);

  await assertProfessionalServiceLink(supabase, profissional.id, servico.id);

  const [periodos, ocupados] = await Promise.all([
    getAgendaPeriodsForDate(supabase, profissional.id, servico.id, data),
    getOccupiedIntervals(supabase, profissional.id, data),
  ]);

  const slotsMap = new Map();

  for (const periodo of periodos) {
    const inicio = timeToMinutes(periodo.hora_inicio);
    const fim = timeToMinutes(periodo.hora_fim);
    const intervaloInicio = timeToMinutes(periodo.intervalo_inicio);
    const intervaloFim = timeToMinutes(periodo.intervalo_fim);
    const duracao = Number(periodo.duracao_slot_minutos || 30);

    if (inicio == null || fim == null || !Number.isInteger(duracao) || duracao <= 0) {
      continue;
    }

    for (let cursor = inicio; cursor + duracao <= fim; cursor += duracao) {
      const slotStart = cursor;
      const slotEnd = cursor + duracao;

      const overlapsInterval =
        intervaloInicio != null &&
        intervaloFim != null &&
        slotStart < intervaloFim &&
        intervaloInicio < slotEnd;

      if (overlapsInterval) continue;

      const horaInicio = minutesToTime(slotStart);
      const horaFim = minutesToTime(slotEnd);

      const ocupado = ocupados.some((item) =>
        rangesOverlap(horaInicio, horaFim, item.horaInicio, item.horaFim),
      );

      if (ocupado) continue;

      const key = `${horaInicio}-${horaFim}`;
      if (!slotsMap.has(key)) {
        slotsMap.set(key, {
          horaInicio,
          horaFim,
          turno: determineTurno(horaInicio),
          agendaId: safeString(periodo.id),
        });
      }
    }
  }

  const slots = Array.from(slotsMap.values()).sort((a, b) =>
    a.horaInicio.localeCompare(b.horaInicio),
  );

  return {
    profissional,
    servico,
    data,
    diaSemana: dateToWeekday(data),
    slots,
  };
}

async function resolveUsuario(supabase, payload) {
  const tipoUsuario = safeString(payload?.tipoUsuario).toUpperCase();

  if (!['MATRICULADO', 'TRIAGEM', 'SERVIDOR', 'EXTERNO'].includes(tipoUsuario)) {
    throw createHttpError('Tipo de usuário inválido.', 400);
  }

  const usuarioId = safeString(payload?.usuarioId);

  if (usuarioId) {
    const { data, error } = await supabase
      .from('sae_usuarios_resumo')
      .select('id,prontuario,nome')
      .eq('id', usuarioId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw createHttpError('Usuário selecionado não foi encontrado.', 404);

    return {
      tipoUsuario,
      usuarioId: safeString(data.id),
      prontuarioInformado: safeString(data.prontuario) || null,
      nomeAvulso: null,
      sexoAvulso: null,
      dataNascimentoAvulso: null,
      usuarioResumo: {
        id: safeString(data.id),
        prontuario: safeString(data.prontuario),
        nome: safeString(data.nome),
      },
    };
  }

  if (tipoUsuario === 'MATRICULADO') {
    throw createHttpError(
      'Selecione um usuário matriculado pelo nome ou prontuário.',
      400,
    );
  }

  const nomeAvulso = safeString(payload?.nomeAvulso);

  if (!nomeAvulso) {
    throw createHttpError(
      'Informe o nome da pessoa para este tipo de agendamento.',
      400,
    );
  }

  return {
    tipoUsuario,
    usuarioId: null,
    prontuarioInformado: safeString(payload?.prontuarioInformado) || null,
    nomeAvulso,
    sexoAvulso: safeString(payload?.sexoAvulso) || null,
    dataNascimentoAvulso: safeString(payload?.dataNascimentoAvulso) || null,
    usuarioResumo: null,
  };
}

async function criarAgendamento({
  supabase,
  authUser,
  actor,
  auditLog,
  payload,
  req,
}) {
  const data = normalizeDate(payload?.data);
  const tipoAtendimento = safeString(payload?.tipoAtendimento).toUpperCase();

  if (!['AVALIAÇÃO', 'REAVALIAÇÃO', 'RETORNO', 'ROTINA'].includes(tipoAtendimento)) {
    throw createHttpError('Tipo de atendimento inválido.', 400);
  }

  const usuario = await resolveUsuario(supabase, payload);

  if (!Array.isArray(payload?.servicos) || payload.servicos.length === 0) {
    throw createHttpError('Inclua pelo menos um serviço no agendamento.', 400);
  }

  const itensValidados = [];

  for (const item of payload.servicos) {
    const profissionalId = safeString(item?.profissionalId);
    const servicoId = safeString(item?.servicoId);
    const horaInicio = normalizeTime(item?.horaInicio);
    const horaFim = normalizeTime(item?.horaFim);

    if (!profissionalId || !servicoId || !horaInicio || !horaFim) {
      throw createHttpError(
        'Serviço, profissional, horário inicial e horário final são obrigatórios.',
        400,
      );
    }

    const disponibilidade = await consultarDisponibilidade(supabase, {
      profissionalId,
      servicoId,
      data,
    });

    const slot = disponibilidade.slots.find(
      (itemDisponivel) =>
        normalizeTime(itemDisponivel.horaInicio) === horaInicio &&
        normalizeTime(itemDisponivel.horaFim) === horaFim,
    );

    if (!slot) {
      throw createHttpError(
        `O horário ${horaInicio.slice(0, 5)}–${horaFim.slice(0, 5)} não está mais disponível para ${disponibilidade.profissional.nome}. Atualize os horários e tente novamente.`,
        409,
        {
          profissionalId,
          servicoId,
          data,
        },
      );
    }

    itensValidados.push({
      servicoId,
      profissionalId,
      turno: slot.turno,
      horaInicio,
      horaFim,
      observacao: safeString(item?.observacao) || null,
      profissionalNome: disponibilidade.profissional.nome,
      servicoNome: disponibilidade.servico.nome,
    });
  }

  const { data: agendamentoRow, error: agendamentoError } = await supabase
    .from('sae_agendamentos')
    .insert({
      data,
      tipo_usuario: usuario.tipoUsuario,
      usuario_id: usuario.usuarioId,
      prontuario_informado: usuario.prontuarioInformado,
      nome_avulso: usuario.nomeAvulso,
      sexo_avulso: usuario.sexoAvulso,
      data_nascimento_avulso: usuario.dataNascimentoAvulso,
      tipo_atendimento: tipoAtendimento,
      status: 'AGENDADO',
      observacao: safeString(payload?.observacao) || null,
      created_by: authUser?.id || null,
      updated_by: authUser?.id || null,
    })
    .select('*')
    .single();

  if (agendamentoError) throw agendamentoError;

  try {
    const servicePayload = itensValidados.map((item) => ({
      agendamento_id: agendamentoRow.id,
      servico_id: item.servicoId,
      profissional_id: item.profissionalId,
      turno: item.turno,
      hora_inicio: item.horaInicio,
      hora_fim: item.horaFim,
      status: 'AGENDADO',
      observacao: item.observacao,
      created_by: authUser?.id || null,
      updated_by: authUser?.id || null,
    }));

    const { data: serviceRows, error: serviceError } = await supabase
      .from('sae_agendamento_servicos')
      .insert(servicePayload)
      .select('*');

    if (serviceError) throw serviceError;

    await auditLog(req, {
      action: 'CREATE_SAE_AGENDAMENTO',
      module: MODULE_NAME,
      entityType: 'sae_agendamento',
      entityId: safeString(agendamentoRow.id),
      entityLabel:
        usuario.usuarioResumo?.nome || usuario.nomeAvulso || usuario.prontuarioInformado || 'Usuário',
      description: `Agendamento SAE criado por ${actor?.email || authUser?.email || 'usuário autenticado'}.`,
      metadata: {
        data,
        tipo_usuario: usuario.tipoUsuario,
        tipo_atendimento: tipoAtendimento,
        servicos: itensValidados.map((item) => ({
          servico_id: item.servicoId,
          servico_nome: item.servicoNome,
          profissional_id: item.profissionalId,
          profissional_nome: item.profissionalNome,
          hora_inicio: item.horaInicio,
          hora_fim: item.horaFim,
        })),
      },
    });

    return {
      id: safeString(agendamentoRow.id),
      status: 'AGENDADO',
      data,
      servicos: serviceRows || [],
    };
  } catch (error) {
    await supabase
      .from('sae_agendamentos')
      .delete()
      .eq('id', agendamentoRow.id);

    throw error;
  }
}

module.exports = {
  listarCatalogo,
  buscarUsuarios,
  consultarDisponibilidade,
  criarAgendamento,
};
