const { normalizeLinhaMapa } = require('../utils/mapaDataNormalizer');
const { buildMapaDiagnostics } = require('../utils/mapaDiagnosticsBuilder');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function resolveLayout(requestedLayout, linhas) {
  if (requestedLayout && requestedLayout !== 'automatico') return requestedLayout;
  return linhas[0]?.tipoLayout || 'setrabes_simples';
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
  if (error) throw error;
  return data || [];
}

async function fetchOcorrencias(filters) {
  const mes = String(filters.mes).padStart(2, '0');
  const startDate = `${filters.ano}-${mes}-01`;
  const endDate = `${filters.ano}-${mes}-31`;

  const [faltasRes, feriasRes, atestadosRes] = await Promise.all([
    supabase.from('faltas').select('*').gte('data', startDate).lte('data', endDate),
    supabase.from('ferias').select('*'),
    supabase.from('atestados').select('*').gte('data_inicio', startDate).lte('data_fim', endDate),
  ]);

  if (faltasRes.error) throw faltasRes.error;
  if (feriasRes.error && !String(feriasRes.error.message || '').includes('does not exist')) throw feriasRes.error;
  if (atestadosRes.error && !String(atestadosRes.error.message || '').includes('does not exist')) throw atestadosRes.error;

  return {
    faltas: faltasRes.data || [],
    ferias: feriasRes.data || [],
    atestados: atestadosRes.data || [],
  };
}

function buildObservacao(servidor, ocorrencias) {
  const cpf = String(servidor.cpf || '').trim();
  const nome = String(servidor.nome_completo || '').trim();
  const observacoes = [];

  const faltasServidor = (ocorrencias.faltas || []).filter((item) =>
    String(item.cpf || item.servidor_cpf || '').trim() === cpf ||
    String(item.nome_servidor || item.nome || '').trim() === nome
  );

  const atestadosServidor = (ocorrencias.atestados || []).filter((item) =>
    String(item.cpf || item.servidor_cpf || '').trim() === cpf ||
    String(item.nome_servidor || item.nome || '').trim() === nome
  );

  const feriasServidor = (ocorrencias.ferias || []).filter((item) =>
    String(item.servidor_cpf || item.cpf || '').trim() === cpf ||
    String(item.nome_completo || item.nome || '').trim() === nome
  );

  if (String(servidor.observacao || '').trim()) observacoes.push(String(servidor.observacao).trim());
  if (faltasServidor.length) observacoes.push(`${faltasServidor.length} falta(s) registrada(s) no período.`);
  if (atestadosServidor.length) {
    const primeiro = atestadosServidor[0];
    observacoes.push(`Atestado registrado${primeiro?.data_inicio ? ` a partir de ${primeiro.data_inicio}` : ''}.`);
  }
  if (feriasServidor.length) {
    const f = feriasServidor[0];
    const inicio = f?.periodo1_inicio || f?.data_inicio || '';
    const fim = f?.periodo1_fim || f?.data_fim || '';
    if (inicio || fim) observacoes.push(`Férias no período de ${inicio || '—'} a ${fim || '—'}.`);
  }

  return observacoes.join(' ');
}

function buildLinhaFromServidor(servidor, index, filters, ocorrencias) {
  const observacao = buildObservacao(servidor, ocorrencias);
  const faltasCount = (ocorrencias.faltas || []).filter((item) =>
    String(item.cpf || item.servidor_cpf || '').trim() === String(servidor.cpf || '').trim()
  ).length;

  return normalizeLinhaMapa({
    ...servidor,
    ordem: index + 1,
    frequencia_texto: servidor.frequencia || 'INTEGRAL',
    faltas: faltasCount > 0 ? String(faltasCount) : '-',
    observacao,
    data_inicio_setor: servidor.inicio_exercicio || servidor.data_inicio_setor,
    lotacao_interna: servidor.lotacao_interna || servidor.setor,
    carga_horaria: servidor.carga_horaria,
  }, index, filters.layout);
}

async function getMapaPreview(filters) {
  const servidores = await fetchServidores(filters);
  const ocorrencias = await fetchOcorrencias(filters);
  const linhas = servidores.map((servidor, index) => buildLinhaFromServidor(servidor, index, filters, ocorrencias));
  const layout = resolveLayout(filters.layout, linhas);
  const diagnostics = buildMapaDiagnostics(linhas);

  return {
    ok: true,
    layout,
    filtros: filters,
    stats: {
      totalServidores: linhas.length,
      totalPendencias: diagnostics.totalComPendenciaGrave,
      totalComObservacao: diagnostics.totalComObservacao,
      totalAptosExportacao: Math.max(0, linhas.length - diagnostics.totalComPendenciaGrave),
    },
    diagnostics,
    linhas,
  };
}

module.exports = {
  getMapaPreview,
};
