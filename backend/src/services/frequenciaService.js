const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[frequenciaService] SUPABASE_URL ou SUPABASE_SERVICE_KEY não definidos.');
}

const supabase = createClient(
  SUPABASE_URL || 'https://invalid.local',
  SUPABASE_SERVICE_KEY || 'invalid'
);

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';

  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function buildMonthRange(ano, mes) {
  const start = `${ano}-${pad2(mes)}-01`;
  const lastDay = new Date(Number(ano), Number(mes), 0).getDate();
  const end = `${ano}-${pad2(mes)}-${pad2(lastDay)}`;
  return { start, end };
}

function mapRow(row) {
  return {
    id: row?.id,
    servidor_id: row?.servidor_id || '',
    servidorId: row?.servidor_id || '',
    servidor_cpf: row?.servidor_cpf || '',
    servidorCpf: row?.servidor_cpf || '',
    data: normalizeDate(row?.data),
    tipo: normalizeText(row?.tipo || row?.ocorrencia).toUpperCase(),
    turno: normalizeText(row?.turno || 'INTEGRAL').toUpperCase(),
    descricao: normalizeText(row?.descricao || row?.observacao),
    observacao: normalizeText(row?.descricao || row?.observacao),
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

function buildInsertPayload(body) {
  const payload = {
    data: normalizeDate(body?.data),
    tipo: normalizeText(body?.tipo).toUpperCase(),
    turno: normalizeText(body?.turno || 'INTEGRAL').toUpperCase(),
    descricao: normalizeText(body?.descricao || body?.observacao),
  };

  const servidorId = normalizeText(body?.servidorId || body?.servidor_id);
  const servidorCpf = onlyDigits(body?.servidorCpf || body?.servidor_cpf);

  if (servidorId) payload.servidor_id = servidorId;
  if (servidorCpf) payload.servidor_cpf = servidorCpf;

  return payload;
}

function buildUpdatePayload(body) {
  const payload = {};

  if (body?.servidorId !== undefined || body?.servidor_id !== undefined) {
    payload.servidor_id = normalizeText(body?.servidorId || body?.servidor_id);
  }

  if (body?.servidorCpf !== undefined || body?.servidor_cpf !== undefined) {
    payload.servidor_cpf = onlyDigits(body?.servidorCpf || body?.servidor_cpf);
  }

  if (body?.data !== undefined) {
    payload.data = normalizeDate(body?.data);
  }

  if (body?.tipo !== undefined) {
    payload.tipo = normalizeText(body?.tipo).toUpperCase();
  }

  if (body?.turno !== undefined) {
    payload.turno = normalizeText(body?.turno).toUpperCase();
  }

  if (body?.descricao !== undefined || body?.observacao !== undefined) {
    payload.descricao = normalizeText(body?.descricao || body?.observacao);
  }

  return payload;
}

async function listarFrequencia(query) {
  const ano = Number(query?.ano);
  const mes = Number(query?.mes);
  const servidorId = normalizeText(query?.servidorId || query?.servidor_id);
  const servidorCpf = onlyDigits(query?.servidorCpf || query?.servidor_cpf);
  const tipo = normalizeText(query?.tipo).toUpperCase();

  let builder = supabase.from('frequencia').select('*');

  if (ano && mes) {
    const { start, end } = buildMonthRange(ano, mes);
    builder = builder.gte('data', start).lte('data', end);
  }

  if (servidorId) {
    builder = builder.eq('servidor_id', servidorId);
  } else if (servidorCpf) {
    builder = builder.eq('servidor_cpf', servidorCpf);
  }

  if (tipo) {
    builder = builder.eq('tipo', tipo);
  }

  const { data, error } = await builder.order('data', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) ? data.map(mapRow) : [];
}

async function obterOcorrenciaPorId(id) {
  const rowId = normalizeText(id);

  if (!rowId) {
    throw new Error('ID inválido.');
  }

  const { data, error } = await supabase
    .from('frequencia')
    .select('*')
    .eq('id', rowId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;

  return mapRow(data);
}

async function criarOcorrencia(body) {
  const payload = buildInsertPayload(body);

  if (!payload.servidor_id && !payload.servidor_cpf) {
    throw new Error('servidorId ou servidorCpf é obrigatório.');
  }

  if (!payload.data) {
    throw new Error('data é obrigatória.');
  }

  if (!payload.tipo) {
    throw new Error('tipo é obrigatório.');
  }

  const { data, error } = await supabase
    .from('frequencia')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRow(data);
}

async function atualizarOcorrencia(id, body) {
  const rowId = normalizeText(id);

  if (!rowId) {
    throw new Error('ID inválido.');
  }

  const payload = buildUpdatePayload(body);

  if (Object.keys(payload).length === 0) {
    const atual = await obterOcorrenciaPorId(rowId);
    if (!atual) {
      throw new Error('Ocorrência não encontrada.');
    }
    return atual;
  }

  const { data, error } = await supabase
    .from('frequencia')
    .update(payload)
    .eq('id', rowId)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRow(data);
}

async function excluirOcorrencia(id) {
  const rowId = normalizeText(id);

  if (!rowId) {
    throw new Error('ID inválido.');
  }

  const { error } = await supabase
    .from('frequencia')
    .delete()
    .eq('id', rowId);

  if (error) {
    throw new Error(error.message);
  }

  return true;
}

module.exports = {
  listarFrequencia,
  obterOcorrenciaPorId,
  criarOcorrencia,
  atualizarOcorrencia,
  excluirOcorrencia,
};
