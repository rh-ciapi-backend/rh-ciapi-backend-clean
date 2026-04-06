const TIPOS_EVENTO = ["FERIADO", "PONTO_FACULTATIVO", "EVENTO"];

function ensureSupabase(supabase) {
  if (!supabase) {
    throw new Error("Cliente Supabase não disponível no app.locals.");
  }
}

function safeString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeText(value) {
  return safeString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeTipo(tipo) {
  const normalized = normalizeText(tipo)
    .replace(/\s+/g, "_")
    .replace(/[^A-Z_]/g, "");

  if (!TIPOS_EVENTO.includes(normalized)) {
    throw new Error("Tipo de evento inválido. Use FERIADO, PONTO_FACULTATIVO ou EVENTO.");
  }

  return normalized;
}

function parseBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;

  const text = normalizeText(value);
  if (["TRUE", "1", "SIM", "S", "ATIVO"].includes(text)) return true;
  if (["FALSE", "0", "NAO", "NÃO", "INATIVO"].includes(text)) return false;
  return fallback;
}

function pad2(value) {
  return String(Number(value) || 0).padStart(2, "0");
}

function isValidDateIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function buildDateIso({ data, ano, mes, dia }) {
  if (safeString(data)) {
    if (!isValidDateIso(String(data))) {
      throw new Error("Data inválida. Use o formato YYYY-MM-DD.");
    }
    return String(data);
  }

  const y = Number(ano);
  const m = Number(mes);
  const d = Number(dia);

  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error("Informe a data completa ou os campos ano, mes e dia.");
  }

  const dateIso = `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;

  if (!isValidDateIso(dateIso)) {
    throw new Error("Data inválida para o evento.");
  }

  return dateIso;
}

function normalizeEventoRow(row) {
  if (!row || typeof row !== "object") return null;

  const data = safeString(row.data ?? row.data_evento ?? row.date);
  const tipo = safeString(row.tipo ?? row.event_type);
  const titulo = safeString(row.titulo ?? row.title);
  const descricao = safeString(row.descricao ?? row.description);
  const ativo = parseBoolean(row.ativo ?? row.active, true);

  return {
    id: row.id,
    data,
    ano: data ? Number(data.slice(0, 4)) : null,
    mes: data ? Number(data.slice(5, 7)) : null,
    dia: data ? Number(data.slice(8, 10)) : null,
    tipo,
    titulo,
    descricao,
    ativo,
    isFeriado: tipo === "FERIADO",
    isPontoFacultativo: tipo === "PONTO_FACULTATIVO",
    isEvento: tipo === "EVENTO",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

async function detectEventosTable(supabase) {
  ensureSupabase(supabase);

  const candidates = ["eventos", "calendario_eventos"];

  for (const table of candidates) {
    const { error } = await supabase
      .from(table)
      .select("id", { head: true, count: "exact" })
      .limit(1);

    if (!error) return table;
  }

  throw new Error(
    "Tabela de eventos não encontrada. Crie a tabela 'eventos' no Supabase ou ajuste o service."
  );
}

async function listarEventos(supabase, filters = {}) {
  ensureSupabase(supabase);
  const table = await detectEventosTable(supabase);

  const ano = Number(filters.ano);
  const mes = Number(filters.mes);
  const tipo = safeString(filters.tipo);
  const ativo = filters.ativo;

  let query = supabase.from(table).select("*").order("data", { ascending: true });

  if (Number.isFinite(ano) && Number.isFinite(mes) && mes >= 1 && mes <= 12) {
    const start = `${String(ano).padStart(4, "0")}-${pad2(mes)}-01`;
    const endDate = new Date(ano, mes, 0);
    const end = `${String(ano).padStart(4, "0")}-${pad2(mes)}-${pad2(endDate.getDate())}`;
    query = query.gte("data", start).lte("data", end);
  } else if (
    (filters.ano !== undefined && !Number.isFinite(ano)) ||
    (filters.mes !== undefined && !Number.isFinite(mes))
  ) {
    throw new Error("Ano e mês inválidos para consulta.");
  }

  if (tipo) {
    query = query.eq("tipo", normalizeTipo(tipo));
  }

  if (typeof ativo === "boolean") {
    query = query.eq("ativo", ativo);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Falha ao listar eventos: ${error.message}`);
  }

  return (Array.isArray(data) ? data : []).map(normalizeEventoRow).filter(Boolean);
}

async function obterEventoPorId(supabase, id) {
  ensureSupabase(supabase);
  const table = await detectEventosTable(supabase);

  const safeId = safeString(id);
  if (!safeId) {
    throw new Error("ID do evento é obrigatório.");
  }

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("id", safeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao consultar evento: ${error.message}`);
  }

  if (!data) {
    throw new Error("Evento não encontrado.");
  }

  return normalizeEventoRow(data);
}

function buildPayload(input = {}, current = null) {
  const data = buildDateIso({
    data: input.data ?? current?.data,
    ano: input.ano,
    mes: input.mes,
    dia: input.dia,
  });

  const tipo = normalizeTipo(input.tipo ?? current?.tipo);
  const titulo =
    safeString(input.titulo, "") ||
    (tipo === "FERIADO"
      ? "Feriado"
      : tipo === "PONTO_FACULTATIVO"
      ? "Ponto Facultativo"
      : "Evento");

  const descricao = safeString(input.descricao, current?.descricao ?? "");
  const ativo = parseBoolean(
    input.ativo !== undefined ? input.ativo : current?.ativo,
    true
  );

  return {
    data,
    tipo,
    titulo,
    descricao,
    ativo,
  };
}

async function ensureNoDuplicate(supabase, table, payload, exceptId = null) {
  const { data, error } = await supabase
    .from(table)
    .select("id,data,tipo")
    .eq("data", payload.data)
    .eq("tipo", payload.tipo);

  if (error) {
    throw new Error(`Falha ao validar duplicidade: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  const conflict = rows.find((row) => String(row.id) !== String(exceptId ?? ""));

  if (conflict) {
    throw new Error("Já existe um evento deste tipo cadastrado para esta data.");
  }
}

async function criarEvento(supabase, input = {}) {
  ensureSupabase(supabase);
  const table = await detectEventosTable(supabase);
  const payload = buildPayload(input, null);

  await ensureNoDuplicate(supabase, table, payload);

  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Falha ao criar evento: ${error.message}`);
  }

  return normalizeEventoRow(data);
}

async function atualizarEvento(supabase, id, input = {}) {
  ensureSupabase(supabase);
  const table = await detectEventosTable(supabase);
  const current = await obterEventoPorId(supabase, id);
  const payload = buildPayload(input, current);

  await ensureNoDuplicate(supabase, table, payload, id);

  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .eq("id", safeString(id))
    .select("*")
    .single();

  if (error) {
    throw new Error(`Falha ao atualizar evento: ${error.message}`);
  }

  return normalizeEventoRow(data);
}

async function excluirEvento(supabase, id) {
  ensureSupabase(supabase);
  const table = await detectEventosTable(supabase);
  const current = await obterEventoPorId(supabase, id);

  const { error } = await supabase.from(table).delete().eq("id", safeString(id));

  if (error) {
    throw new Error(`Falha ao excluir evento: ${error.message}`);
  }

  return current;
}

function listarTiposEvento() {
  return TIPOS_EVENTO.map((tipo) => ({
    value: tipo,
    label:
      tipo === "FERIADO"
        ? "Feriado"
        : tipo === "PONTO_FACULTATIVO"
        ? "Ponto Facultativo"
        : "Evento",
  }));
}

module.exports = {
  TIPOS_EVENTO,
  listarEventos,
  obterEventoPorId,
  criarEvento,
  atualizarEvento,
  excluirEvento,
  listarTiposEvento,
};
