const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórias");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const PAGE_SIZE = 18;

function safeString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeText(value) {
  return safeString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function onlyDigits(value) {
  return safeString(value).replace(/\D/g, "");
}

function escapeHtml(value) {
  return safeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateBr(value) {
  if (!value) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return raw;

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
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
    };
  }

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    return {
      year: Number(br[3]),
      month: Number(br[2]),
      day: Number(br[1]),
    };
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
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
    : new Date(year, month, 0);

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  return intervalStart <= monthEnd && intervalEnd >= monthStart;
}

function normalizeCategory(value) {
  const v = normalizeText(value);

  const valid = [
    "EFETIVO SESAU",
    "SELETIVO SESAU",
    "EFETIVO SETRABES",
    "SELETIVO SETRABES",
    "FEDERAIS SETRABES",
    "COMISSIONADOS",
  ];

  const found = valid.find((item) => normalizeText(item) === v);
  return found || safeString(value, "NÃO INFORMADO");
}

function normalizeStatus(value) {
  const v = normalizeText(value);
  if (v === "ATIVO") return "ATIVO";
  if (v === "INATIVO") return "INATIVO";
  return safeString(value, "NÃO INFORMADO");
}

function monthNamePtBr(month) {
  const names = {
    1: "Janeiro",
    2: "Fevereiro",
    3: "Março",
    4: "Abril",
    5: "Maio",
    6: "Junho",
    7: "Julho",
    8: "Agosto",
    9: "Setembro",
    10: "Outubro",
    11: "Novembro",
    12: "Dezembro",
  };

  return names[Number(month)] || "Todos os meses";
}

function yearNow() {
  return new Date().getFullYear();
}

function pickRequestData(payload) {
  const body = payload?.body || {};
  const query = payload?.query || {};
  return { ...query, ...body };
}

function parseMonth(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

function normalizeFilters(raw) {
  return {
    setor: safeString(raw.setor || raw.lotacao || raw.setorFiltro, "TODOS OS SETORES"),
    categoria: safeString(raw.categoria || raw.category || raw.categoriaFiltro, "TODAS"),
    status: safeString(raw.status || raw.statusServidor, "ATIVO"),
    mes: parseMonth(raw.mes ?? raw.month ?? null),
    ano: Number(raw.ano ?? raw.year ?? yearNow()) || yearNow(),
    ordenacao: safeString(raw.ordenacao || raw.orderBy, "Nome A-Z"),
    tipoExtracao: safeString(
      raw.tipoExtracao || raw.tipo_extracao || raw.extracao,
      "Somente servidores com férias cadastradas"
    ),
    formato: safeString(raw.formato || raw.outputFormat, "DOC"),
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
  const { data, error } = await supabase
    .from("ferias")
    .select("*");

  if (error) {
    throw new Error(`Erro ao consultar férias: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

function buildServidoresIndex(rows) {
  const byCpf = new Map();
  const byNome = new Map();

  for (const row of rows) {
    const cpf = onlyDigits(row?.cpf);
    const nome = normalizeText(row?.nomeCompleto || row?.nome_completo || row?.nome);

    if (cpf) byCpf.set(cpf, row);
    if (nome) byNome.set(nome, row);
  }

  return { byCpf, byNome };
}

function resolveServidorFromFerias(feriasRow, index) {
  const cpf = onlyDigits(
    feriasRow?.servidor_cpf || feriasRow?.cpf || feriasRow?.cpf_servidor
  );

  if (cpf && index.byCpf.has(cpf)) {
    return index.byCpf.get(cpf);
  }

  const nome = normalizeText(
    feriasRow?.nome || feriasRow?.nome_servidor || feriasRow?.servidor_nome || feriasRow?.servidor
  );

  if (nome && index.byNome.has(nome)) {
    return index.byNome.get(nome);
  }

  return null;
}

function buildMergedRow(servidor, feriasRow, filters) {
  const nome = safeString(
    servidor?.nomeCompleto || servidor?.nome_completo || servidor?.nome,
    feriasRow?.nome || feriasRow?.nome_servidor || feriasRow?.servidor_nome || "NOME NÃO INFORMADO"
  );

  const matricula = safeString(
    servidor?.matricula || feriasRow?.matricula,
    ""
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

  const p1i = feriasRow?.periodo1_inicio || null;
  const p1f = feriasRow?.periodo1_fim || null;
  const p2i = feriasRow?.periodo2_inicio || null;
  const p2f = feriasRow?.periodo2_fim || null;
  const p3i = feriasRow?.periodo3_inicio || null;
  const p3f = feriasRow?.periodo3_fim || null;

  const possuiFerias = !!(p1i || p1f || p2i || p2f || p3i || p3f);

  const possuiFeriasNoMes =
    periodTouchesMonth(p1i, p1f, filters.mes, filters.ano) ||
    periodTouchesMonth(p2i, p2f, filters.mes, filters.ano) ||
    periodTouchesMonth(p3i, p3f, filters.mes, filters.ano);

  return {
    nome,
    matricula,
    categoria,
    setor,
    status,
    cpf,
    exercicio: String(filters.ano),
    periodo1_inicio: formatDateBr(p1i),
    periodo1_fim: formatDateBr(p1f),
    periodo2_inicio: formatDateBr(p2i),
    periodo2_fim: formatDateBr(p2f),
    periodo3_inicio: formatDateBr(p3i),
    periodo3_fim: formatDateBr(p3f),
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
    normalizeText(filters.setor) !== "TODAS" &&
    normalizeText(filters.setor) !== "TODOS OS SETORES"
  ) {
    result = result.filter(
      (row) => normalizeText(row.setor) === normalizeText(filters.setor)
    );
  }

  const tipo = normalizeText(filters.tipoExtracao);

  if (
    tipo === "SOMENTE SERVIDORES COM FERIAS CADASTRADAS" ||
    tipo === "SOMENTE_COM_FERIAS"
  ) {
    result = result.filter((row) => row.possuiFerias);
  }

  if (
    tipo === "SOMENTE FERIAS NO MES" ||
    tipo === "SOMENTE_COM_FERIAS_NO_MES"
  ) {
    result = result.filter((row) => row.possuiFeriasNoMes);
  }

  if (filters.mes) {
    result = result.filter((row) => row.possuiFeriasNoMes);
  }

  const ord = normalizeText(filters.ordenacao);

  if (ord === "NOME Z-A") {
    result.sort((a, b) => b.nome.localeCompare(a.nome, "pt-BR"));
  } else if (ord === "SETOR A-Z") {
    result.sort(
      (a, b) =>
        a.setor.localeCompare(b.setor, "pt-BR") ||
        a.nome.localeCompare(b.nome, "pt-BR")
    );
  } else {
    result.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  return result.map((row, index) => ({
    ...row,
    ordem: index + 1,
  }));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildTableRows(rows) {
  if (!rows.length) {
    return `
      <tr>
        <td class="cell center">1</td>
        <td class="cell left">NENHUM REGISTRO ENCONTRADO</td>
        <td class="cell center"></td>
        <td class="cell center"></td>
        <td class="cell center"></td>
        <td class="cell center"></td>
        <td class="cell center"></td>
        <td class="cell center"></td>
        <td class="cell center"></td>
        <td class="cell center"></td>
        <td class="cell signature">&nbsp;</td>
      </tr>
    `;
  }

  return rows
    .map(
      (row) => `
        <tr>
          <td class="cell center">${row.ordem}</td>
          <td class="cell left">${escapeHtml(row.nome)}</td>
          <td class="cell center">${escapeHtml(row.matricula)}</td>
          <td class="cell center">${escapeHtml(row.exercicio)}</td>
          <td class="cell center">${escapeHtml(row.periodo1_inicio)}</td>
          <td class="cell center">${escapeHtml(row.periodo1_fim)}</td>
          <td class="cell center">${escapeHtml(row.periodo2_inicio)}</td>
          <td class="cell center">${escapeHtml(row.periodo2_fim)}</td>
          <td class="cell center">${escapeHtml(row.periodo3_inicio)}</td>
          <td class="cell center">${escapeHtml(row.periodo3_fim)}</td>
          <td class="cell signature">&nbsp;</td>
        </tr>
      `
    )
    .join("\n");
}

function buildSection({ rows, filters, totalArquivo, pageIndex, totalPages }) {
  const categoriaTitulo =
    normalizeText(filters.categoria) === "TODAS" || normalizeText(filters.categoria) === "TODOS"
      ? "SERVIDORES - TODAS AS CATEGORIAS"
      : `SERVIDORES ${safeString(filters.categoria).toUpperCase()}`;

  const grupoCategoria =
    normalizeText(filters.categoria) === "TODAS" || normalizeText(filters.categoria) === "TODOS"
      ? "TODAS"
      : safeString(filters.categoria).toUpperCase();

  const setorLabel =
    normalizeText(filters.setor) === "TODOS" ||
    normalizeText(filters.setor) === "TODAS" ||
    normalizeText(filters.setor) === "TODOS OS SETORES"
      ? "TODOS OS SETORES"
      : safeString(filters.setor).toUpperCase();

  return `
    <section class="sheet ${pageIndex < totalPages - 1 ? "page-break" : ""}">
      <div class="header">
        <div class="gov">GOVERNO DO ESTADO DE RORAIMA</div>
        <div class="org">SECRETARIA DE ESTADO DO TRABALHO E BEM-ESTAR SOCIAL</div>
        <div class="org">CENTRO INTEGRADO DE ATENÇÃO À PESSOA IDOSA - CIAPI</div>
        <div class="title">PROGRAMAÇÃO ANUAL DE FÉRIAS - EXERCÍCIO/${escapeHtml(filters.ano)}</div>
        <div class="subtitle">${escapeHtml(categoriaTitulo)}</div>
      </div>

      <div class="meta">
        <div><strong>GRUPO/CATEGORIA:</strong> ${escapeHtml(grupoCategoria)}</div>
        <div><strong>SETOR:</strong> ${escapeHtml(setorLabel)}</div>
      </div>

      <div class="summary">
        <strong>Tipo:</strong> ${escapeHtml(filters.tipoExtracao)} &nbsp;&nbsp;
        <strong>Status:</strong> ${escapeHtml(filters.status)} &nbsp;&nbsp;
        <strong>Mês:</strong> ${escapeHtml(monthNamePtBr(filters.mes))} &nbsp;&nbsp;
        <strong>Ordenação:</strong> ${escapeHtml(filters.ordenacao)}<br />
        <strong>Linhas desta seção:</strong> ${rows.length} &nbsp;&nbsp;
        <strong>Total do arquivo:</strong> ${totalArquivo} &nbsp;&nbsp;
        <strong>Página:</strong> ${pageIndex + 1}/${totalPages}
      </div>

      <table>
        <thead>
          <tr>
            <th rowspan="2" class="ncol">Nº</th>
            <th rowspan="2">NOME DO SERVIDOR</th>
            <th rowspan="2">MATRÍCULA</th>
            <th rowspan="2">EXERCÍCIO</th>
            <th colspan="2">1º PERÍODO</th>
            <th colspan="2">2º PERÍODO</th>
            <th colspan="2">3º PERÍODO</th>
            <th rowspan="2" class="acol">ASSINATURA</th>
          </tr>
          <tr>
            <th>INÍCIO</th>
            <th>TÉRMINO</th>
            <th>INÍCIO</th>
            <th>TÉRMINO</th>
            <th>INÍCIO</th>
            <th>TÉRMINO</th>
          </tr>
        </thead>
        <tbody>
          ${buildTableRows(rows)}
        </tbody>
      </table>
    </section>
  `;
}

function buildHtmlDocument(rows, filters) {
  const pages = chunkArray(rows, PAGE_SIZE);
  const safePages = pages.length ? pages : [[]];

  const sections = safePages
    .map((pageRows, index) =>
      buildSection({
        rows: pageRows,
        filters,
        totalArquivo: rows.length,
        pageIndex: index,
        totalPages: safePages.length,
      })
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Programação Anual de Férias</title>
<style>
  @page {
    size: A4 landscape;
    margin: 1.1cm;
  }

  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    margin: 0;
    padding: 0;
    font-size: 10pt;
    background: #fff;
  }

  .sheet {
    width: 100%;
  }

  .page-break {
    page-break-after: always;
  }

  .header {
    text-align: center;
    margin-bottom: 10px;
  }

  .gov { font-size: 11pt; font-weight: 700; }
  .org { font-size: 9pt; font-weight: 700; }
  .title {
    margin-top: 8px;
    font-size: 12pt;
    font-weight: 700;
    text-transform: uppercase;
  }

  .subtitle {
    margin-top: 4px;
    font-size: 10pt;
    font-weight: 700;
    text-transform: uppercase;
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin: 10px 0;
    font-size: 9pt;
    font-weight: 700;
  }

  .summary {
    margin-bottom: 10px;
    border: 1px solid #000;
    padding: 8px;
    font-size: 8.5pt;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  thead {
    display: table-header-group;
  }

  tr {
    page-break-inside: avoid;
  }

  th, td {
    border: 1px solid #000;
    padding: 4px;
    vertical-align: middle;
  }

  th {
    background: #efefef;
    text-align: center;
    font-size: 8.8pt;
  }

  .cell { font-size: 8.8pt; }
  .left { text-align: left; }
  .center { text-align: center; }
  .signature { height: 22px; }
  .ncol { width: 28px; }
  .acol { width: 110px; }
</style>
</head>
<body>
${sections}
</body>
</html>`;
}

async function exportarFeriasTemplate(payload = {}) {
  const rawFilters = pickRequestData(payload);
  const filters = normalizeFilters(rawFilters);

  const [servidores, ferias] = await Promise.all([
    fetchServidores(),
    fetchFerias(),
  ]);

  const index = buildServidoresIndex(servidores);

  const feriasByCpf = new Map();
  const feriasByNome = new Map();

  for (const item of ferias) {
    const cpf = onlyDigits(
      item?.servidor_cpf || item?.cpf || item?.cpf_servidor
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

    mergedRows.push(buildMergedRow(servidor, feriasRow, filters));
  }

  for (const feriasRow of ferias) {
    const servidorEncontrado = resolveServidorFromFerias(feriasRow, index);
    if (servidorEncontrado) continue;
    mergedRows.push(buildMergedRow(null, feriasRow, filters));
  }

  const filteredRows = applyFilters(mergedRows, filters);
  const html = buildHtmlDocument(filteredRows, filters);

  const categoriaSlug =
    normalizeText(filters.categoria)
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^\w]/g, "") || "todas";

  const setorSlug =
    normalizeText(filters.setor)
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^\w]/g, "") || "todos_setores";

  const mesSlug = filters.mes ? monthNamePtBr(filters.mes).toLowerCase() : "todos_meses";

  return {
    buffer: Buffer.from("\uFEFF" + html, "utf8"),
    fileName: `ferias_${filters.ano}_${categoriaSlug}_${setorSlug}_${mesSlug}.doc`,
    contentType: "application/msword",
    meta: {
      totalRegistros: filteredRows.length,
      filtros: filters,
    },
  };
}

module.exports = exportarFeriasTemplate;
