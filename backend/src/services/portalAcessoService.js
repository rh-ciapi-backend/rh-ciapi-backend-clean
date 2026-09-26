const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const tentativas = new Map();

function falha(mensagem, statusCode = 400) {
  const erro = new Error(mensagem);
  erro.statusCode = statusCode;
  return erro;
}

function cpfLimpo(valor) {
  const cpf = String(valor || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(cpf)) throw falha('Informe um CPF válido.');
  return cpf;
}

function emailInterno(cpf) {
  return `${cpf}@acesso.rhciapi.com.br`;
}

function senhaInterna(cpf) {
  const segredo = String(process.env.PORTAL_AUTH_SECRET || '');
  if (segredo.length < 32) throw falha('Configure PORTAL_AUTH_SECRET no backend.', 503);
  return crypto.createHmac('sha256', segredo).update(`requerimento:${cpf}`).digest('hex');
}

function linkPortal(token) {
  return `${String(process.env.PORTAL_FRONTEND_URL || 'https://www.rhciapi.com.br').replace(/\/$/, '')}/#/requerimento?acesso=${token}`;
}

async function buscarServidor(supabase, servidorId) {
  const id = String(servidorId || '').trim();
  if (!id) throw falha('Selecione um servidor.');
  const { data: amostra, error: erroAmostra } = await supabase.from('servidores').select('*').limit(1);
  if (erroAmostra) throw erroAmostra;
  const colunas = new Set(Object.keys(amostra?.[0] || {}));
  for (const coluna of ['servidor', 'id', 'servidor_id', 'uuid', 'matricula']) {
    if (!colunas.has(coluna)) continue;
    const { data, error } = await supabase.from('servidores').select('*').eq(coluna, id).limit(1).maybeSingle();
    if (error?.code === '22P02') continue;
    if (error) throw error;
    if (data) return data;
  }
  throw falha('Servidor não encontrado.', 404);
}

async function buscarPorCpf(supabase, cpf) {
  for (const valor of [cpf, cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')]) {
    const { data, error } = await supabase.from('servidores').select('*').eq('cpf', valor).limit(1).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return null;
}

async function criarAcesso(supabase, servidorId) {
  const servidor = await buscarServidor(supabase, servidorId);
  const cpf = cpfLimpo(servidor.cpf);
  const token = crypto.randomBytes(32).toString('hex');
  const convite_hash = crypto.createHash('sha256').update(token).digest('hex');
  const { data: existente, error: erroExistente } = await supabase
    .from('rh_servidor_acessos').select('auth_uid').eq('servidor_id', String(servidorId)).maybeSingle();
  if (erroExistente) throw erroExistente;
  if (existente) {
    const { data: usuario, error: erroUsuario } = await supabase.auth.admin.getUserById(existente.auth_uid);
    if (erroUsuario) throw erroUsuario;
    if (usuario?.user?.email !== emailInterno(cpf)) {
      throw falha('Este servidor já possui outro tipo de acesso. Verifique o cadastro antes de gerar o link.', 409);
    }
    const { error } = await supabase.from('rh_servidor_acessos')
      .update({ convite_hash }).eq('servidor_id', String(servidorId));
    if (error) throw error;
    return { url: linkPortal(token), cpf, criado: false };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: emailInterno(cpf), password: senhaInterna(cpf), email_confirm: true,
  });
  if (error || !data?.user) throw falha(error?.message || 'Falha ao criar acesso do servidor.', 409);

  const { error: erroVinculo } = await supabase.from('rh_servidor_acessos').insert({
    auth_uid: data.user.id, servidor_id: String(servidorId), convite_hash,
  });
  if (erroVinculo) {
    await supabase.auth.admin.deleteUser(data.user.id);
    throw erroVinculo;
  }
  return { url: linkPortal(token), cpf, criado: true };
}

async function entrar(supabase, cpfInformado, pinInformado, convite, ip) {
  const cpf = cpfLimpo(cpfInformado);
  const pin = String(pinInformado || '');
  const chave = `${ip}:${cpf}`;
  const registro = tentativas.get(chave) || { quantidade: 0, ate: 0 };
  if (registro.ate > Date.now()) throw falha('Aguarde alguns minutos e tente novamente.', 429);

  const servidor = await buscarPorCpf(supabase, cpf);
  if (!servidor || pin !== cpf.slice(0, 5)) {
    const quantidade = registro.quantidade + 1;
    tentativas.set(chave, { quantidade, ate: quantidade >= 5 ? Date.now() + 15 * 60_000 : 0 });
    throw falha('CPF ou senha inválidos.', 401);
  }

  const autenticador = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await autenticador.auth.signInWithPassword({
    email: emailInterno(cpf), password: senhaInterna(cpf),
  });
  if (error || !data?.session) {
    tentativas.set(chave, { quantidade: registro.quantidade + 1, ate: Date.now() + 60_000 });
    throw falha('CPF ou senha inválidos.', 401);
  }
  const { data: vinculo, error: erroVinculo } = await supabase.from('rh_servidor_acessos')
    .select('servidor_id,convite_hash').eq('auth_uid', data.user.id).maybeSingle();
  if (erroVinculo) throw erroVinculo;
  if (!vinculo) throw falha('Acesso não vinculado a servidor.', 403);
  const hash = crypto.createHash('sha256').update(String(convite || '')).digest('hex');
  if (!vinculo.convite_hash || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(vinculo.convite_hash))) {
    tentativas.set(chave, { quantidade: registro.quantidade + 1, ate: Date.now() + 60_000 });
    throw falha('Link de acesso inválido. Solicite um novo link ao RH.', 403);
  }
  tentativas.delete(chave);
  return data.session;
}

module.exports = { criarAcesso, entrar };
