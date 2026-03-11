const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórias");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const TEMPLATE_CANDIDATES = [
  path.join(__dirname, "../../templates/modelo_ferias_oficial.docx"),
  path.join(__dirname, "../../templates/modelo_ferias.docx"),
  path.join(__dirname, "../../templates/ferias/modelo_ferias_oficial.docx"),
];

function resolveTemplatePath() {
  for (const filePath of TEMPLATE_CANDIDATES) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  throw new Error(
    `Template oficial de férias não encontrado. Verifique um destes caminhos: ${TEMPLATE_CANDIDATES.join(
      " | "
    )}`
  );
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function safeString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeStatus(value) {
  const v = normalizeText(value);
  if (v === "ATIVO") return "ATIVO";
  if (v === "INATIVO") return "INATIVO";
  return safeString(value, "NÃO INFORMADO");
}

function normalizeCategory(value) {
  const v = normalizeText(value);

  const known = [
    "EFETIVO SESAU",
    "SELETIVO SESAU",
    "EFETIVO SETRABES",
    "SELETIVO SETRABES",
    "FEDERAIS SETRABES",
    "COMISSIONADOS",
  ];

  const found = known.find((item) => normalizeText(item) === v);
  return found || safeString(value, "NÃO INFORMADO");
}

function parseBoolean(value, defaultValue = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "sim", "yes"].includes(v)) return true;
    if (["0", "false", "nao", "não", "no"].includes(v)) return false;
  }
  return defaultValue;
}

function parseMonth(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

function formatDateBr(value) {
  if (!value) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  }

  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) {
    return raw;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear());
    return `${day}/${month}/${year}`;
  }

  return raw;
}

function parseIsoDate(value) {
  if (!value) return null;
  const raw = String(value).trim();

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      iso: `${iso[1]}-${iso[2]}-${iso[3]}`,
    };
  }

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    return {
      year: Number(br[3]),
      month: Number(br[2]),
      day: Number(br[1]),
      iso: `${br[3]}-${br[2]}-${br[1]}`,
    };
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      iso: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(date.getDate()).padStart(2, "0")}`,
    };
  }

  return null;
}

function periodTouchesMonth(start, end, month, year) {
  if (!month || !year) return true;
  if (!start && !end) return false;

  const startDate = parseIsoDate(start);
  const endDate = parseIsoDate(end);

  if (!startDate && !endDate) return false;

  const intervalStart = startDate
    ? new Date(startDate.year, startDate.month - 1, startDate.day)
    : new Date(year, month - 1, 1);

  const intervalEnd = endDate
    ? new Date(endDate.year, endDate.month - 1, endDate.day)
    : new Date(year, month - 1 + 1, 0);

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  return intervalStart <= monthEnd && intervalEnd >= monthStart;
}

function normalizePeriod(start, end, month, year) {
  const hasAny = safeString(start) || safeString(end);
  if (!hasAny) {
    return {
      inicio: "",
      fim: "",
      valido: false,
      noMes: false,
    };
  }

  const inicio = formatDateBr(start);
  const fim = formatDateBr(end);
  const noMes = periodTouchesMonth(start, end, month, year);

  return {
    inicio,
    fim,
    valido: !!(inicio || fim),
    noMes,
  };
}

function monthNamePtBr(monthNumber) {
  const months = [
    "",
    "JANEIRO",
    "FEVEREIRO",
    "MARÇO",
    "ABRIL",
    "MAIO",
    "JUNHO",
    "JULHO",
    "AGOSTO",
    "SETEMBRO",
    "OUTUBRO",
    "NOVEMBRO",
    "DEZEMBRO",
  ];
  return months[monthNumber] || "TODOS OS MESES";
}

function formatNowBr() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function pickRequestData(payload) {
  const body = payload?.body || {};
  const query = payload?.query || {};
  return { ...query, ...body };
}

function normalizeFilters(raw) {
  const setor = safeString(raw.setor || raw.lotacao || raw.setorFiltro, "Todos");
  const categoria = safeString(
    raw.categoria || raw.category || raw.categoriaFiltro,
    "Todas"
  );
  const status = safeString(raw.status || raw.statusServidor, "ATIVO");
  const mes = raw.mes ?? raw.month ?? null;
  const ano = raw.ano ?? raw.year ?? new Date().getFullYear();
  const formato = safeString(raw.formato || raw.outputFormat, "DOCX");
  const tipoExtracao = safeString(
    raw.tipoExtracao || raw.tipo_extracao || raw.extracao,
    "somente_com_ferias"
  );
  const ordenar = safeString(raw.ordenacao || raw.orderBy, "nome_az");

  return {
    setor,
    categoria,
    status,
    mes: parseMonth(mes),
    ano: Number(ano) || new Date().getFullYear(),
    formato,
    tipoExtracao: normalizeText(tipoExtracao),
    ordenar: normalizeText(ordenar),
  };
}

async function fetchServidores() {
  const { data, error } = await supabase
    .from("servidores")
    .select("*")
    .order("nome", { ascending: true });

  if (error) {
    throw new Error(`Erro ao consultar servidores: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

async function fetchFerias() {
  const { data, error } = await supabase.from("ferias").select("*");

  if (error) {
    throw new Error(`Erro ao consultar férias: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

function buildServidoresIndex(rows) {
  const byCpf = new Map();
  const byNome = new Map();

  for (const row of rows) {
    const cpf = onlyDigits(
      row?.cpf || row?.servidor_cpf || row?.cpf_servidor || row?.documento
    );
    const nome = normalizeText(
      row?.nomeCompleto || row?.nome_completo || row?.nome || row?.servidor_nome
    );

    if (cpf) byCpf.set(cpf, row);
    if (nome) byNome.set(nome, row);
  }

  return { byCpf, byNome };
}

function resolveServidorFromFerias(feriasRow, index) {
  const cpfKey = onlyDigits(
    feriasRow?.servidor_cpf ||
      feriasRow?.cpf ||
      feriasRow?.cpf_servidor ||
      feriasRow?.documento
  );

  if (cpfKey && index.byCpf.has(cpfKey)) {
    return index.byCpf.get(cpfKey);
  }

  const nomeKey = normalizeText(
    feriasRow?.nome ||
      feriasRow?.nome_servidor ||
      feriasRow?.servidor_nome ||
      feriasRow?.servidor
  );

  if (nomeKey && index.byNome.has(nomeKey)) {
    return index.byNome.get(nomeKey);
  }

  return null;
}

function mergeServidorFerias(servidor, feriasRow, filters) {
  const nome = safeString(
    servidor?.nomeCompleto || servidor?.nome_completo || servidor?.nome,
    safeString(
      feriasRow?.nome || feriasRow?.nome_servidor || feriasRow?.servidor_nome,
      "NOME NÃO INFORMADO"
    )
  );

  const matricula = safeString(
    servidor?.matricula || feriasRow?.matricula,
    "NÃO INFORMADA"
  );

  const categoria = normalizeCategory(
    servidor?.categoriaCanonica ||
      servidor?.categoria_canonica ||
      servidor?.categoria ||
      feriasRow?.categoria
  );

  const setor = safeString(
    servidor?.setor || servidor?.lotacao || feriasRow?.setor,
    "NÃO INFORMADO"
  );

  const status = normalizeStatus(
    servidor?.status || feriasRow?.status || "ATIVO"
  );

  const cpf = onlyDigits(
    servidor?.cpf ||
      feriasRow?.servidor_cpf ||
      feriasRow?.cpf ||
      feriasRow?.cpf_servidor
  );

  const periodo1 = normalizePeriod(
    feriasRow?.periodo1_inicio,
    feriasRow?.periodo1_fim,
    filters.mes,
    filters.ano
  );
  const periodo2 = normalizePeriod(
    feriasRow?.periodo2_inicio,
    feriasRow?.periodo2_fim,
    filters.mes,
    filters.ano
  );
  const periodo3 = normalizePeriod(
    feriasRow?.periodo3_inicio,
    feriasRow?.periodo3_fim,
    filters.mes,
    filters.ano
  );

  const possuiFerias =
    periodo1.valido || periodo2.valido || periodo3.valido || !!feriasRow;

  const possuiFeriasNoMes =
    periodo1.noMes || periodo2.noMes || periodo3.noMes || false;

  return {
    nome,
    matricula,
    categoria,
    setor,
    status,
    cpf: cpf
      ? cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
      : "",
    periodo1_inicio: periodo1.inicio,
    periodo1_fim: periodo1.fim,
    periodo2_inicio: periodo2.inicio,
    periodo2_fim: periodo2.fim,
    periodo3_inicio: periodo3.inicio,
    periodo3_fim: periodo3.fim,
    possuiFerias,
    possuiFeriasNoMes,
  };
}

function applyFilters(rows, filters) {
  let result = [...rows];

  if (normalizeText(filters.status) !== "TODOS") {
    result = result.filter(
      (row) => normalizeText(row.status) === normalizeText(filters.status)
    );
  }

  if (
    normalizeText(filters.categoria) !== "TODAS" &&
    normalizeText(filters.categoria) !== "TODOS"
  ) {
    result = result.filter(
      (row) => normalizeText(row.categoria) === normalizeText(filters.categoria)
    );
  }

  if (
    normalizeText(filters.setor) !== "TODOS" &&
    normalizeText(filters.setor) !== "TODAS"
  ) {
    result = result.filter(
      (row) => normalizeText(row.setor) === normalizeText(filters.setor)
    );
  }

  if (filters.mes && filters.ano) {
    result = result.filter(
      (row) =>
        row.possuiFeriasNoMes ||
        normalizeText(filters.tipoExtracao) === "TODOS" ||
        normalizeText(filters.tipoExtracao) === "TODOS_OS_SERVIDORES"
    );
  }

  const tipo = normalizeText(filters.tipoExtracao);

  if (
    tipo === "SOMENTE_COM_FERIAS" ||
    tipo === "SOMENTE_SERVIDORES_COM_FERIAS_CADASTRADAS"
  ) {
    result = result.filter((row) => row.possuiFerias);
  }

  if (
    tipo === "SOMENTE_COM_FERIAS_NO_MES" ||
    tipo === "SOMENTE_FERIAS_NO_MES"
  ) {
    result = result.filter((row) => row.possuiFeriasNoMes);
  }

  if (filters.ordenar === "NOME_ZA") {
    result.sort((a, b) => b.nome.localeCompare(a.nome, "pt-BR"));
  } else if (filters.ordenar === "SETOR_AZ") {
    result.sort(
      (a, b) =>
        a.setor.localeCompare(b.setor, "pt-BR") ||
        a.nome.localeCompare(b.nome, "pt-BR")
    );
  } else if (filters.ordenar === "CATEGORIA_AZ") {
    result.sort(
      (a, b) =>
        a.categoria.localeCompare(b.categoria, "pt-BR") ||
        a.nome.localeCompare(b.nome, "pt-BR")
    );
  } else {
    result.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  return result.map((row, idx) => ({
    ...row,
    ordem: idx + 1,
  }));
}

function buildContext(rows, filters) {
  const totalComFerias = rows.filter((row) => row.possuiFerias).length;
  const totalSemFerias = rows.filter((row) => !row.possuiFerias).length;

  return {
    titulo: "PROGRAMAÇÃO ANUAL DE FÉRIAS",
    subtitulo: "CIAPI RH",
    data_geracao: formatNowBr(),
    ano_referencia: String(filters.ano),
    mes_referencia: filters.mes ? monthNamePtBr(filters.mes) : "TODOS OS MESES",
    setor_filtro: filters.setor || "Todos",
    categoria_filtro: filters.categoria || "Todas",
    status_filtro: filters.status || "Todos",
    tipo_extracao: filters.tipoExtracao || "SOMENTE_COM_FERIAS",
    formato_saida: filters.formato || "DOCX",
    total_registros: rows.length,
    total_com_ferias: totalComFerias,
    total_sem_ferias: totalSemFerias,
    linhas: rows.map((row) => ({
      ordem: row.ordem,
      nome: row.nome,
      matricula: row.matricula,
      categoria: row.categoria,
      setor: row.setor,
      status: row.status,
      cpf: row.cpf,
      periodo1_inicio: row.periodo1_inicio,
      periodo1_fim: row.periodo1_fim,
      periodo2_inicio: row.periodo2_inicio,
      periodo2_fim: row.periodo2_fim,
      periodo3_inicio: row.periodo3_inicio,
      periodo3_fim: row.periodo3_fim,
    })),
  };
}

function renderDocx(context) {
  const templatePath = resolveTemplatePath();
  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter() {
      return "";
    },
  });

  doc.render(context);

  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}

async function exportarFeriasTemplate(payload = {}) {
  const requestData = pickRequestData(payload);
  const filters = normalizeFilters(requestData);

  const [servidores, ferias] = await Promise.all([fetchServidores(), fetchFerias()]);
  const index = buildServidoresIndex(servidores);

  const feriasByCpf = new Map();
  const feriasByNome = new Map();

  for (const item of ferias) {
    const cpf = onlyDigits(
      item?.servidor_cpf || item?.cpf || item?.cpf_servidor || item?.documento
    );
    const nome = normalizeText(
      item?.nome || item?.nome_servidor || item?.servidor_nome || item?.servidor
    );

    if (cpf) feriasByCpf.set(cpf, item);
    if (nome) feriasByNome.set(nome, item);
  }

  const mergedRows = [];

  for (const servidor of servidores) {
    const cpf = onlyDigits(servidor?.cpf);
    const nome = normalizeText(
      servidor?.nomeCompleto || servidor?.nome_completo || servidor?.nome
    );

    const feriasRow =
      (cpf && feriasByCpf.get(cpf)) ||
      (nome && feriasByNome.get(nome)) ||
      null;

    mergedRows.push(mergeServidorFerias(servidor, feriasRow, filters));
  }

  for (const feriasRow of ferias) {
    const servidorEncontrado = resolveServidorFromFerias(feriasRow, index);
    if (servidorEncontrado) continue;

    mergedRows.push(mergeServidorFerias(null, feriasRow, filters));
  }

  const filteredRows = applyFilters(mergedRows, filters);
  const context = buildContext(filteredRows, filters);
  const buffer = renderDocx(context);

  const fileNameParts = ["programacao_ferias"];

  if (filters.mes) {
    fileNameParts.push(String(filters.mes).padStart(2, "0"));
  } else {
    fileNameParts.push("todos_os_meses");
  }

  fileNameParts.push(String(filters.ano));

  return {
    buffer,
    fileName: `${fileNameParts.join("_")}.docx`,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    meta: {
      totalRegistros: context.total_registros,
      totalComFerias: context.total_com_ferias,
      totalSemFerias: context.total_sem_ferias,
      filtros: filters,
    },
  };
}

module.exports = exportarFeriasTemplate;
