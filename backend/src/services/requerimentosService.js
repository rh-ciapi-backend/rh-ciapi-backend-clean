const PERFIL_SERVIDOR = 'SERVIDOR_LIMITADO';

const CAMPOS = new Set([
  'nome', 'nacionalidade', 'estadoCivil', 'cpf', 'rg', 'orgaoExpedidor',
  'dataExpedicao', 'pasep', 'tituloEleitor', 'dataNascimento', 'pai', 'mae',
  'cargo', 'matricula', 'funcao', 'classe', 'lotacao', 'unidadeExercicio',
  'endereco', 'numero', 'complemento', 'bairro', 'cep', 'municipio', 'uf',
  'telefoneTrabalho', 'telefoneResidencial', 'celular', 'regime',
  'situacao', 'dataExoneracao',
]);

function erro(message, statusCode = 400) {
  const result = new Error(message);
  result.statusCode = statusCode;
  return result;
}

function texto(value, limite = 250) {
  return typeof value === 'string' ? value.trim().slice(0, limite) : '';
}

function filtrarCampos(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw erro('Dados do formulário inválidos.');
  }
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (CAMPOS.has(key)) {
      const conteudo = texto(value, 500);
      result[key] = key.startsWith('data') ? conteudo : conteudo.toLocaleUpperCase('pt-BR');
    }
  }
  return result;
}

async function idDoServidor(supabase, authUser, currentUser, solicitado) {
  if (currentUser.perfil !== PERFIL_SERVIDOR) {
    const id = texto(solicitado, 100);
    if (!id) throw erro('Selecione um servidor.');
    return id;
  }

  const { data, error } = await supabase
    .from('rh_servidor_acessos')
    .select('servidor_id')
    .eq('auth_uid', authUser.id)
    .maybeSingle();

  if (error) throw error;
  if (!data?.servidor_id) {
    throw erro('Conta ainda não vinculada ao cadastro do servidor.', 403);
  }
  return data.servidor_id;
}

async function buscarServidor(supabase, referencia) {
  const id = texto(referencia, 100);
  if (!id) throw erro('Selecione um servidor.');

  const { data: amostra, error: erroAmostra } = await supabase
    .from('servidores').select('*').limit(1);

  if (erroAmostra) throw erroAmostra;
  if (!amostra?.length) throw erro('Servidor não encontrado.', 404);

  const colunas = new Set(Object.keys(amostra[0]));
  const cpf = id.replace(/\D/g, '');
  const cpfFormatado = cpf.length === 11
    ? cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    : '';

  const candidatos = [
    ['servidor', id],
    ['id', id],
    ['servidor_id', id],
    ['uuid', id],
    ...(cpf.length === 11 ? [['cpf', cpf], ['cpf', cpfFormatado]] : []),
    ['matricula', id],
    ['nome_completo', id],
  ];

  for (const [coluna, valor] of candidatos) {
    if (!colunas.has(coluna)) continue;

    const { data, error } = await supabase
      .from('servidores')
      .select('*')
      .eq(coluna, valor)
      .limit(1)
      .maybeSingle();

    if (error?.code === '22P02') continue;
    if (error) throw error;
    if (data) return data;
  }

  throw erro('Servidor não encontrado.', 404);
}

async function listar({ supabase, authUser, currentUser }) {
  let query = supabase
    .from('rh_requerimentos')
    .select('id,servidor_id,tipo,detalhes,status,criado_em,atualizado_em')
    .order('criado_em', { ascending: false })
    .limit(100);

  if (currentUser.perfil === PERFIL_SERVIDOR) {
    const servidorId = await idDoServidor(supabase, authUser, currentUser);
    query = query.eq('servidor_id', servidorId);
  }

  const { data, error } = await query;
  if (error) throw error;
  const itens = data || [];
  if (currentUser.perfil === PERFIL_SERVIDOR || !itens.length) return itens;

  const ids = [...new Set(itens.map((item) => item.servidor_id).filter(Boolean))];
  const { data: amostra, error: erroAmostra } = await supabase
    .from('servidores').select('*').limit(1);
  if (erroAmostra) throw erroAmostra;
  const colunas = new Set(Object.keys(amostra?.[0] || {}));
  const nomes = new Map();
  for (const coluna of ['servidor', 'id', 'servidor_id', 'uuid']) {
    if (!colunas.has(coluna)) continue;
    const { data: servidores, error: erroServidores } = await supabase
      .from('servidores').select('*').in(coluna, ids);
    if (erroServidores?.code === '22P02') continue;
    if (erroServidores) throw erroServidores;
    for (const servidor of servidores || []) {
      nomes.set(String(servidor[coluna]), servidor.nome_completo || servidor.nomeCompleto || servidor.nome);
    }
  }
  return itens.map((item) => ({
    ...item,
    servidor_nome: nomes.get(String(item.servidor_id)) || null,
  }));
}

async function obterFormulario({ supabase, authUser, currentUser, servidorId }) {
  const id = await idDoServidor(supabase, authUser, currentUser, servidorId);
  const servidor = await buscarServidor(supabase, id);

  const { data: complemento, error: erroComplemento } = await supabase
    .from('rh_servidor_complementos')
    .select('dados')
    .eq('servidor_id', id)
    .maybeSingle();

  if (erroComplemento) throw erroComplemento;
  return { servidor, complemento: complemento?.dados || {} };
}

async function criar({ supabase, authUser, currentUser, payload }) {
  const id = await idDoServidor(
    supabase, authUser, currentUser, payload?.servidorId
  );
  const tipo = texto(payload?.tipo, 180);
  const detalhes = texto(payload?.detalhes, 5000);

  if (!tipo) throw erro('Selecione o tipo de requerimento.');
  const dados = filtrarCampos(payload?.dados);

  await buscarServidor(supabase, id);

  const { error: erroComplemento } = await supabase
    .from('rh_servidor_complementos')
    .upsert(
      {
        servidor_id: id,
        dados,
        atualizado_por: authUser.id,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'servidor_id' }
    );

  if (erroComplemento) throw erroComplemento;

  const { data: requerimento, error: erroRequerimento } = await supabase
    .from('rh_requerimentos')
    .insert({
      servidor_id: id,
      enviado_por: authUser.id,
      tipo,
      detalhes,
      dados_snapshot: dados,
    })
    .select('id,servidor_id,tipo,detalhes,status,criado_em')
    .single();

  if (erroRequerimento) throw erroRequerimento;
  return requerimento;
}

async function obterParaExportacao({ supabase, authUser, currentUser, requerimentoId }) {
  const id = texto(requerimentoId, 100);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw erro('Requerimento não encontrado.', 404);

  let query = supabase
    .from('rh_requerimentos')
    .select('id,servidor_id,tipo,detalhes,dados_snapshot,criado_em')
    .eq('id', id);

  if (currentUser.perfil === PERFIL_SERVIDOR) {
    const servidorId = await idDoServidor(supabase, authUser, currentUser);
    query = query.eq('servidor_id', servidorId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw erro('Requerimento não encontrado.', 404);
  return data;
}

module.exports = { listar, obterFormulario, criar, obterParaExportacao };
