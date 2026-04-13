const { normalizeLinhaMapa } = require('../utils/mapaDataNormalizer');
const { buildMapaDiagnostics } = require('../utils/mapaDiagnosticsBuilder');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveLayout(requestedLayout, linhas) {
  if (requestedLayout && requestedLayout !== 'automatico') return requestedLayout;
  return linhas[0]?.tipoLayout || 'setrabes_simples';
}

async function safeSelect(table, builder) {
  try {
    let query = supabase.from(table).select('*');

    if (typeof builder === 'function') {
      query = builder(query) || query;
    }

    const { data, error } = await query;

    if (error) {
      const msg = String(error.message || '');

      if (
        msg.includes('does not exist') ||
        msg.includes('Could not find') ||
        msg.includes('schema cache') ||
        msg.includes('column') ||
        msg.includes('relation')
      ) {
        console.warn(`[mapasService] tabela/estrutura não disponível: ${table} -> ${msg}`);
        return [];
      }

      throw error;
    }

    return safeArray(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[mapasService] falha tolerada em ${table}: ${msg}`);
    return [];
  }
}

async function fetchServidores(filters) {
  let query = supabase
    .from('servidores')
    .select('*')
    .order('nome_completo', { ascending: true });

  if (filters.categoria) query = query.eq('categoria', filters.categoria);
  if (filters.setor) query = query.eq('setor', filters.setor);
  if (filters.status && filters.status !== 'TODOS') query = query.eq('status', filters.status);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao consultar servidores: ${error.message}`);
  }

  return safeArray(data);
}

async function fetchOcorrencias(filters) {
  const mes = String(filters.mes).padStart(2, '0');
  const startDate = `${filters.ano}-${mes}-01`;
  const endDate = `${filters.ano}-${mes}-31`;

  const [faltas, ferias, atestados] = await Promise.all([
    safeSelect('faltas', (q) => q.gte('data', startDate).lte('data', endDate)),
    safeSelect('ferias'),
    safeSelect('atestados', (q) => q.gte('data_inicio', startDate).lte('data_fim', endDate)),
  ]);

  return { faltas, ferias, atestados };
}

function samePerson(item, servidor) {
  const cpfA = text(item?.cpf || item?.servidor_cpf);
  const cpfB = text(servidor?.cpf);
  const nomeA = text(item?.nome_servidor || item?.nome || item?.nome_completo);
  const nomeB = text(servidor?.nome_completo || servidor?.nome);

  if (cpfA && cpfB) return cpfA === cpfB;
  if (nomeA && nomeB) return nomeA.toUpperCase() === nomeB.toUpperCase();

  return false;
}

function formatPeriodo(inicio, fim) {
  const a = text(inicio, '—');
  const b = text(fim, '—');
  return `${a} a ${b}`;
}

function buildObservacao(servidor, ocorrencias) {
  const observacoes = [];

  const faltasServidor = safeArray(ocorrencias.faltas).filter((item) => samePerson(item, servidor));
  const atestadosServidor = safeArray(ocorrencias.atestados).filter((item) => samePerson(item, servidor));
  const feriasServidor = safeArray(ocorrencias.ferias).filter((item) => samePerson(item, servidor));

  const baseObs = text(
    servidor.observacao ||
      servidor.observacoes ||
      servidor.obs ||
      servidor.descricao
  );

  if (baseObs) observacoes.push(baseObs);

  if (faltasServidor.length) {
    observacoes.push(`${faltasServidor.length} falta(s) registrada(s) no período.`);
  }

  if (atestadosServidor.length) {
    const primeiro = atestadosServidor[0];
    const inicio = primeiro?.data_inicio || primeiro?.inicio || primeiro?.data;
    const fim = primeiro?.data_fim || primeiro?.fim || '';

    observacoes.push(
      fim
        ? `Atestado no período de ${formatPeriodo(inicio, fim)}.`
        : `Atestado registrado${inicio ? ` em ${inicio}` : ''}.`
    );
  }

  if (feriasServidor.length) {
    const f = feriasServidor[0];
    const p1i = f?.periodo1_inicio || f?.data_inicio || '';
    const p1f = f?.periodo1_fim || f?.data_fim || '';

    if (p1i || p1f) {
      observacoes.push(`Férias no período de ${formatPeriodo(p1i, p1f)}.`);
    }
  }

  return observacoes.join(' ').trim();
}

function countFaltas(servidor, ocorrencias) {
  return safeArray(ocorrencias.faltas).filter((item) => samePerson(item, servidor)).length;
}

function buildLinhaFromServidor(servidor, index, filters, ocorrencias) {
  const observacao = buildObservacao(servidor, ocorrencias);
  const faltasCount = countFaltas(servidor, ocorrencias);

  return normalizeLinhaMapa(
    {
      ...servidor,
      ordem: index + 1,
      nome_completo:
        servidor.nome_completo ||
        servidor.nome ||
        servidor.nomeCompleto ||
        'NÃO INFORMADO',
      matricula:
        servidor.matricula ||
        servidor.matricula_servidor ||
        servidor.servidor_matricula ||
        '',
      matricula_sigrh:
        servidor.matricula_sigrh ||
        servidor.sigrh ||
        servidor.matriculaSigrh ||
        '',
      frequencia_texto:
        servidor.frequencia ||
        servidor.frequencia_texto ||
        servidor.freq ||
        'INTEGRAL',
      faltas: faltasCount > 0 ? String(faltasCount) : '-',
      observacao,
      data_inicio_setor:
        servidor.data_inicio_setor ||
        servidor.inicio_exercicio ||
        servidor.data_admissao ||
        '',
      lotacao_interna:
        servidor.lotacao_interna ||
        servidor.setor ||
        servidor.lotacao ||
        '',
      carga_horaria:
        servidor.carga_horaria ||
        servidor.ch_semanal ||
        servidor.ch_diaria ||
        '',
      categoria:
        servidor.categoria ||
        servidor.categoria_canonica ||
        '',
      setor:
        servidor.setor ||
        servidor.lotacao ||
        '',
      status:
        servidor.status ||
        'ATIVO',
    },
    index,
    filters.layout
  );
}

async function getMapaPreview(filters) {
  const normalizedFilters = {
    mes: Number(filters?.mes) || new Date().getMonth() + 1,
    ano: Number(filters?.ano) || new Date().getFullYear(),
    categoria: text(filters?.categoria),
    setor: text(filters?.setor),
    status: text(filters?.status, 'ATIVO').toUpperCase(),
    layout: text(filters?.layout, 'automatico'),
    modoExportacao: text(filters?.modoExportacao, 'arquivo_unico'),
  };

  const servidores = await fetchServidores(normalizedFilters);
  const ocorrencias = await fetchOcorrencias(normalizedFilters);

  const linhas = servidores.map((servidor, index) =>
    buildLinhaFromServidor(servidor, index, normalizedFilters, ocorrencias)
  );

  const layout = resolveLayout(normalizedFilters.layout, linhas);
  const diagnostics = buildMapaDiagnostics(linhas);

  return {
    ok: true,
    layout,
    filtros: normalizedFilters,
    stats: {
      totalServidores: linhas.length,
      totalPendencias: diagnostics.totalComPendenciaGrave,
      totalComObservacao: diagnostics.totalComObservacao,
      totalAptosExportacao: Math.max(
        0,
        linhas.length - diagnostics.totalComPendenciaGrave
      ),
    },
    diagnostics,
    linhas,
  };
}

module.exports = {
  getMapaPreview,
};
