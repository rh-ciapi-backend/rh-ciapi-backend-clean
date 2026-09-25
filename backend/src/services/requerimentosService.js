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
    if (CAMPOS.has(key)) result[key] = texto(value, 500);
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
  return data || [];
}

async function obterFormulario({ supabase, authUser, currentUser, servidorId }) {
  const id = await idDoServidor(supabase, authUser, currentUser, servidorId);

  const { data: servidor, error: erroServidor } = await supabase
    .from('servidores')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (erroServidor) throw erroServidor;
  if (!servidor) throw erro('Servidor não encontrado.', 404);

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
    supabase,
    authUser,
    currentUser,
    payload?.servidorId
  );
  const tipo = texto(payload?.tipo, 180);
  const detalhes = texto(payload?.detalhes, 5000);

  if (!tipo) throw erro('Selecione o tipo de requerimento.');
  const dados = filtrarCampos(payload?.dados);

  const { data: servidor, error: erroServidor } = await supabase
    .from('servidores')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (erroServidor) throw erroServidor;
  if (!servidor) throw erro('Servidor não encontrado.', 404);

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

module.exports = { listar, obterFormulario, criar };
