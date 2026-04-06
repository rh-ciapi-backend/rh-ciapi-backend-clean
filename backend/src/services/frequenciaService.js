const { createClient } = require("@supabase/supabase-js");
const { consolidateMonthByServidor } = require("../utils/frequenciaDayMap");
const { buildFrequenciaTemplateData } = require("../utils/frequenciaTemplateBuilder");
const { normalizeDateInput, safeArray } = require("../utils/frequenciaRules");

const fallbackSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function getSupabase(clientFromParams) {
  return clientFromParams || fallbackSupabase;
}

function getMonthRange(year, month) {
  const start = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(year, month, 0);
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function safeText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text || "";
}

function pick(obj, keys, fallback = "") {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return obj[key];
    }
  }
  return fallback;
}

function normalizeCargaHoraria(value) {
  const text = safeText(value);
  if (!text) return "";

  if (/^\d+([.,]\d+)?$/.test(text)) {
    return `${text.replace(",", ".")}h`;
  }

  return text;
}

function normalizeServidor(row) {
  const cpf = onlyDigits(
    pick(row, ["cpf", "servidor_cpf", "cpf_servidor", "documento"])
  );

  const id =
    pick(row, ["servidor", "id", "uuid", "servidor_id", "employee_id"], null) ||
    cpf ||
    pick(row, ["matricula"], "");

  const nome = pick(
    row,
    ["nome_completo", "nome", "servidor_nome", "full_name", "name"],
    "Servidor sem nome"
  );

  const chDiaria = normalizeCargaHoraria(
    pick(row, [
      "ch_diaria",
      "chDiaria",
      "ch_diária",
      "CH_DIARIA",
      "CH_DIÁRIA",
      "c_h_diaria",
      "carga_horaria_diaria",
      "cargaHorariaDiaria",
      "carga_horaria_dia",
      "cargaHorariaDia",
      "carga_diaria",
    ])
  );

  const chSemanal = normalizeCargaHoraria(
    pick(row, [
      "ch_semanal",
      "chSemanal",
      "CH_SEMANAL",
      "c_h_semanal",
      "carga_horaria_semanal",
      "cargaHorariaSemanal",
      "carga_semanal",
      "carga_horaria",
      "cargaHoraria",
    ])
  );

  return {
    id,
    nome,
    cpf,
    matricula: pick(row, ["matricula", "registro", "mat"]),
    categoria: pick(row, ["categoria_canonic", "categoria_canonica", "categoria"]),
    cargo: pick(row, ["cargo", "funcao", "função", "role"]),
    setor: pick(row, ["setor", "lotacao", "lotação", "departamento"]),
    unidade: pick(row, ["unidade", "orgao", "órgão", "secretaria", "setor"]),
    lotacao: pick(row, ["lotacao", "lotação", "setor", "departamento"]),
    status: pick(row, ["status", "situacao"], ""),
    chDiaria,
    chSemanal,
    raw: row,
  };
}

function normalizeOcorrencia(row, forcedTipo = "") {
  return {
    id: pick(row, ["id", "uuid"]),
    data:
      normalizeDateInput(pick(row, ["data", "data_ocorrencia", "date", "dia"])) ||
      normalizeDateInput(pick(row, ["inicio", "data_inicio"])) ||
      null,
    tipo: forcedTipo || pick(row, ["tipo", "type", "ocorrencia_tipo", "kind", "status"]),
    turno: pick(row, ["turno", "periodo", "shift", "turn"], "AMBOS"),
    servidor_cpf: onlyDigits(pick(row, ["servidor_cpf", "cpf", "cpf_servidor"])),
    servidor_id: pick(row, ["servidor", "servidor_id", "employee_id", "id_servidor"]),
    observacao: pick(row, ["observacao", "descricao", "motivo", "obs"]),
    raw: row,
  };
}

function normalizeFeriasRow(row) {
  return {
    ...row,
    servidor_cpf: onlyDigits(pick(row, ["servidor_cpf", "cpf", "cpf_servidor"])),
    periodo1_inicio: normalizeDateInput(row.periodo1_inicio),
    periodo1_fim: normalizeDateInput(row.periodo1_fim),
    periodo2_inicio: normalizeDateInput(row.periodo2_inicio),
    periodo2_fim: normalizeDateInput(row.periodo2_fim),
    periodo3_inicio: normalizeDateInput(row.periodo3_inicio),
    periodo3_fim: normalizeDateInput(row.periodo3_fim),
    inicio: normalizeDateInput(row.inicio || row.data_inicio),
    fim: normalizeDateInput(row.fim || row.data_fim),
  };
}

function normalizeEventoRow(row) {
  return {
    ...row,
    data:
      normalizeDateInput(pick(row, ["data", "date", "data_evento", "dia"])) || null,
    tipo: pick(row, ["tipo", "type", "categoria", "kind"]),
    titulo: pick(row, ["titulo", "title", "nome", "descricao"]),
  };
}

async function fetchServidores({
  supabase,
  cpf,
  servidorCpf,
  setor,
  categoria,
  status,
}) {
  const db = getSupabase(supabase);
  const cpfFiltro = onlyDigits(cpf || servidorCpf);

  let query = db.from("servidores").select("*");

  if (cpfFiltro) {
    query = query.eq("cpf", cpfFiltro);
  }

  if (setor) {
    query = query.ilike("setor", `%${setor}%`);
  }

  if (categoria) {
    query = query.ilike("categoria", `%${categoria}%`);
  }

  if (status && String(status).trim()) {
    query = query.ilike("status", String(status).trim());
  }

  let { data, error } = await query.order("nome", { ascending: true });

  if (error) {
    let fallbackQuery = db.from("servidores").select("*");

    if (cpfFiltro) {
      fallbackQuery = fallbackQuery.eq("cpf", cpfFiltro);
    }

    if (setor) {
      fallbackQuery = fallbackQuery.ilike("setor", `%${setor}%`);
    }

    if (categoria) {
      fallbackQuery = fallbackQuery.ilike("categoria", `%${categoria}%`);
    }

    if (status && String(status).trim()) {
      fallbackQuery = fallbackQuery.ilike("status", String(status).trim());
    }

    const fallback = await fallbackQuery.order("nome_completo", { ascending: true });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    throw new Error(`Erro ao buscar servidores: ${error.message}`);
  }

  return safeArray(data).map(normalizeServidor);
}

async function fetchFerias({ supabase, year, month, servidores }) {
  const db = getSupabase(supabase);
  const { start, end } = getMonthRange(year, month);
  const cpfs = servidores.map((s) => s.cpf).filter(Boolean);

  if (!cpfs.length) return [];

  const { data, error } = await db
    .from("ferias")
    .select("*")
    .in("servidor_cpf", cpfs);

  if (error) {
    throw new Error(`Erro ao buscar férias: ${error.message}`);
  }

  return safeArray(data)
    .map(normalizeFeriasRow)
    .filter((row) => {
      const pairs = [
        [row.periodo1_inicio, row.periodo1_fim],
        [row.periodo2_inicio, row.periodo2_fim],
        [row.periodo3_inicio, row.periodo3_fim],
        [row.inicio, row.fim],
      ];

      return pairs.some(([ini, fim]) => ini && fim && !(fim < start || ini > end));
    });
}

async function fetchEventos({ supabase, year, month }) {
  const db = getSupabase(supabase);
  const { start, end } = getMonthRange(year, month);

  const { data, error } = await db
    .from("eventos")
    .select("*")
    .gte("data", start)
    .lte("data", end)
    .order("data", { ascending: true });

  if (error) {
    throw new Error(`Erro ao buscar eventos: ${error.message}`);
  }

  return safeArray(data).map(normalizeEventoRow);
}

async function fetchOcorrenciasFromFrequenciaOcorrencias({
  supabase,
  year,
  month,
  servidores,
}) {
  const db = getSupabase(supabase);
  const { start, end } = getMonthRange(year, month);
  const cpfs = servidores.map((s) => s.cpf).filter(Boolean);

  if (!cpfs.length) return [];

  const dateFields = ["data", "data_ocorrencia"];
  const cpfFields = ["servidor_cpf", "cpf"];

  for (const cpfField of cpfFields) {
    for (const dateField of dateFields) {
      const { data, error } = await db
        .from("frequencia_ocorrencias")
        .select("*")
        .in(cpfField, cpfs)
        .gte(dateField, start)
        .lte(dateField, end);

      if (!error) {
        return safeArray(data).map((row) => normalizeOcorrencia(row));
      }
    }
  }

  return [];
}

async function fetchFaltasFallback({ supabase, year, month, servidores }) {
  const db = getSupabase(supabase);
  const { start, end } = getMonthRange(year, month);
  const cpfs = servidores.map((s) => s.cpf).filter(Boolean);

  if (!cpfs.length) return [];

  const cpfFields = ["servidor_cpf", "cpf"];
  const dateFields = ["data", "data_ocorrencia", "dia"];

  for (const cpfField of cpfFields) {
    for (const dateField of dateFields) {
      const { data, error } = await db
        .from("faltas")
        .select("*")
        .in(cpfField, cpfs)
        .gte(dateField, start)
        .lte(dateField, end);

      if (!error) {
        return safeArray(data).map((row) => normalizeOcorrencia(row));
      }
    }
  }

  return [];
}

async function fetchAtestadosFallback({ supabase, year, month, servidores }) {
  const db = getSupabase(supabase);
  const { start, end } = getMonthRange(year, month);
  const cpfs = servidores.map((s) => s.cpf).filter(Boolean);

  if (!cpfs.length) return [];

  const rows = [];

  for (const field of ["servidor_cpf", "cpf"]) {
    const { data, error } = await db
      .from("atestados")
      .select("*")
      .in(field, cpfs);

    if (error) {
      continue;
    }

    for (const row of safeArray(data)) {
      const ini =
        normalizeDateInput(row.data_inicio) ||
        normalizeDateInput(row.inicio) ||
        normalizeDateInput(row.data);

      const fim =
        normalizeDateInput(row.data_fim) ||
        normalizeDateInput(row.fim) ||
        ini;

      if (!ini) continue;
      if (fim < start || ini > end) continue;

      let cursor = new Date(`${ini}T12:00:00`);
      const endDate = new Date(`${fim}T12:00:00`);

      while (cursor <= endDate) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, "0");
        const d = String(cursor.getDate()).padStart(2, "0");
        const dataIso = `${y}-${m}-${d}`;

        rows.push(
          normalizeOcorrencia(
            {
              ...row,
              data: dataIso,
              tipo: "ATESTADO",
              turno: row.turno || row.periodo || "AMBOS",
            },
            "ATESTADO"
          )
        );

        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return rows;
  }

  return [];
}

function groupByServidor(servidores, rows) {
  const byCpf = new Map();
  const byId = new Map();

  for (const servidor of servidores) {
    if (servidor.cpf) byCpf.set(servidor.cpf, []);
    if (servidor.id) byId.set(String(servidor.id), []);
  }

  for (const row of safeArray(rows)) {
    const cpf = onlyDigits(row.servidor_cpf || row.cpf);
    const id = row.servidor_id ? String(row.servidor_id) : "";

    if (cpf && byCpf.has(cpf)) {
      byCpf.get(cpf).push(row);
      continue;
    }

    if (id && byId.has(id)) {
      byId.get(id).push(row);
    }
  }

  return { byCpf, byId };
}

async function listarFrequenciaMensal(params = {}) {
  const year = Number(params.ano || params.year);
  const month = Number(params.mes || params.month);

  if (!year || !month) {
    throw new Error("Parâmetros ano e mes são obrigatórios");
  }

  const servidores = await fetchServidores({
    supabase: params.supabase,
    cpf: params.cpf,
    servidorCpf: params.servidorCpf,
    setor: params.setor,
    categoria: params.categoria,
    status: params.status || undefined,
  });

  if (!servidores.length) {
    return {
      ok: true,
      data: [],
      meta: {
        ano: year,
        mes: month,
        totalServidores: 0,
      },
    };
  }

  const [ferias, eventos, ocorrenciasMain, faltasFallback, atestadosFallback] =
    await Promise.all([
      fetchFerias({ supabase: params.supabase, year, month, servidores }),
      fetchEventos({ supabase: params.supabase, year, month }),
      fetchOcorrenciasFromFrequenciaOcorrencias({
        supabase: params.supabase,
        year,
        month,
        servidores,
      }).catch(() => []),
      fetchFaltasFallback({
        supabase: params.supabase,
        year,
        month,
        servidores,
      }).catch(() => []),
      fetchAtestadosFallback({
        supabase: params.supabase,
        year,
        month,
        servidores,
      }).catch(() => []),
    ]);

  const ocorrencias = [
    ...safeArray(ocorrenciasMain),
    ...safeArray(faltasFallback),
    ...safeArray(atestadosFallback),
  ];

  const feriasGrouped = groupByServidor(servidores, ferias);
  const ocorrenciasGrouped = groupByServidor(servidores, ocorrencias);

  const data = servidores.map((servidor) => {
    const servidorFerias =
      (servidor.cpf && feriasGrouped.byCpf.get(servidor.cpf)) ||
      (servidor.id && feriasGrouped.byId.get(String(servidor.id))) ||
      [];

    const servidorOcorrencias =
      (servidor.cpf && ocorrenciasGrouped.byCpf.get(servidor.cpf)) ||
      (servidor.id && ocorrenciasGrouped.byId.get(String(servidor.id))) ||
      [];

    const consolidated = consolidateMonthByServidor({
      year,
      month,
      servidor: {
        id: servidor.id,
        nome: servidor.nome,
        cpf: servidor.cpf,
        matricula: servidor.matricula,
        categoria: servidor.categoria,
        cargo: servidor.cargo,
        setor: servidor.setor,
        unidade: servidor.unidade,
        lotacao: servidor.lotacao,
        status: servidor.status,
        chDiaria: servidor.chDiaria,
        chSemanal: servidor.chSemanal,
      },
      ferias: servidorFerias,
      eventos,
      ocorrencias: servidorOcorrencias,
    });

    return {
      ...consolidated,
      templateData: buildFrequenciaTemplateData(
        consolidated.servidor,
        consolidated.ano,
        consolidated.mes,
        consolidated.dayItems
      ),
    };
  });

  return {
    ok: true,
    data,
    meta: {
      ano: year,
      mes: month,
      totalServidores: data.length,
    },
  };
}

async function registrarOcorrenciaFrequencia({ supabase, payload = {} }) {
  const db = getSupabase(supabase);

  const insertPayload = {
    servidor_cpf: onlyDigits(payload.servidor_cpf || payload.cpf),
    data: normalizeDateInput(payload.data),
    tipo: payload.tipo,
    turno: payload.turno || "AMBOS",
    observacao: payload.observacao || "",
  };

  const { data, error } = await db
    .from("frequencia_ocorrencias")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao criar ocorrência: ${error.message}`);
  }

  return {
    ok: true,
    data,
  };
}

async function editarOcorrenciaFrequencia({ supabase, id, payload = {} }) {
  const db = getSupabase(supabase);
  const updatePayload = {};

  if (payload.data) updatePayload.data = normalizeDateInput(payload.data);
  if (payload.tipo !== undefined) updatePayload.tipo = payload.tipo;
  if (payload.turno !== undefined) updatePayload.turno = payload.turno;
  if (payload.observacao !== undefined) updatePayload.observacao = payload.observacao;

  const { data, error } = await db
    .from("frequencia_ocorrencias")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao editar ocorrência: ${error.message}`);
  }

  return {
    ok: true,
    data,
  };
}

async function excluirOcorrenciaFrequencia({ supabase, id }) {
  const db = getSupabase(supabase);

  const { error } = await db
    .from("frequencia_ocorrencias")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Erro ao excluir ocorrência: ${error.message}`);
  }

  return {
    ok: true,
  };
}

module.exports = {
  listarFrequenciaMensal,
  registrarOcorrenciaFrequencia,
  editarOcorrenciaFrequencia,
  excluirOcorrenciaFrequencia,
};
