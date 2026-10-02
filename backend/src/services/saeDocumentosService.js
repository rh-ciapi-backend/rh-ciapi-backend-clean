const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const BUCKET = 'sae-prontuarios';
const MODEL_CODE_SOCIAL = 'SERVICO_SOCIAL_FICHA_AVALIACAO';

function safeString(value) {
  return String(value ?? '').trim();
}

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function slugify(value) {
  return (
    safeString(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'documento'
  );
}

function normalizeFieldValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value === true) return 'SIM';
  if (value === false) return 'NÃO';
  return safeString(value);
}

function normalizeModel(row) {
  return {
    id: safeString(row.id),
    codigo: safeString(row.codigo),
    nome: safeString(row.nome),
    descricao: safeString(row.descricao) || null,
    servicoId: safeString(row.servico_id),
    servicoNome: safeString(row?.sae_servicos?.nome),
    servicoSigla: safeString(row?.sae_servicos?.sigla),
    campos: Array.isArray(row.campos) ? row.campos : [],
    ativo: Boolean(row.ativo),
  };
}

function normalizeDocument(row) {
  return {
    id: safeString(row.id),
    usuarioId: safeString(row.usuario_id),
    modeloId: safeString(row.modelo_id),
    profissionalId: safeString(row.profissional_id),
    servicoId: safeString(row.servico_id),
    titulo: safeString(row.titulo),
    status: safeString(row.status) || 'RASCUNHO',
    dados: row.dados && typeof row.dados === 'object' ? row.dados : {},
    arquivoAssinadoNome: safeString(row.arquivo_assinado_nome) || null,
    arquivoAssinadoMime: safeString(row.arquivo_assinado_mime) || null,
    versao: Number(row.versao || 1),
    finalizadoAt: row.finalizado_at || null,
    assinadoAt: row.assinado_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    modeloNome: safeString(row?.sae_modelos_documentos?.nome),
    modeloCodigo: safeString(row?.sae_modelos_documentos?.codigo),
    profissionalNome: safeString(row?.sae_profissionais?.nome),
    servicoNome: safeString(row?.sae_servicos?.nome),
    servicoSigla: safeString(row?.sae_servicos?.sigla),
  };
}

async function getProfessionalByAuthUser(supabase, authUserId) {
  const id = safeString(authUserId);
  if (!id) return null;

  const { data, error } = await supabase
    .from('sae_profissionais')
    .select('id,auth_user_id,nome,registro_profissional,conselho,cargo_funcao,email,ativo')
    .eq('auth_user_id', id)
    .limit(2);

  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return null;
  if (rows.length > 1) {
    throw createHttpError('Este login está vinculado a mais de um profissional do SAE.', 409);
  }

  const row = rows[0];
  const { data: vinculos, error: vinculosError } = await supabase
    .from('sae_profissional_servicos')
    .select('servico_id,ativo')
    .eq('profissional_id', row.id)
    .eq('ativo', true);

  if (vinculosError) throw vinculosError;

  return {
    id: safeString(row.id),
    authUserId: safeString(row.auth_user_id),
    nome: safeString(row.nome),
    registroProfissional: safeString(row.registro_profissional) || null,
    conselho: safeString(row.conselho) || null,
    cargoFuncao: safeString(row.cargo_funcao) || null,
    email: safeString(row.email) || null,
    ativo: Boolean(row.ativo),
    servicoIds: (vinculos || []).map((item) => safeString(item.servico_id)).filter(Boolean),
  };
}

function actorCanAdmin(actor) {
  if (!actor) return false;
  if (actor.is_master) return true;
  const permission = (actor.permissions || []).find((item) => item.module === 'sae_profissionais');
  return Boolean(
    permission?.allowed &&
      (permission.actions || []).some((action) =>
        ['visualizar', 'editar', 'gerenciar_usuarios'].includes(action),
      ),
  );
}

async function assertUserExists(supabase, usuarioId) {
  const id = safeString(usuarioId);
  if (!id) throw createHttpError('Usuário do prontuário não informado.', 400);

  const { data, error } = await supabase
    .from('sae_usuarios_resumo')
    .select('id,prontuario,nome,sexo,nacionalidade,data_nascimento,idade,telefone_principal,bairro,endereco_original')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError('Usuário do SAE não encontrado.', 404);
  return data;
}

async function listarModelosPermitidos(supabase, profissional, actor) {
  let query = supabase
    .from('sae_modelos_documentos')
    .select('*,sae_servicos(id,nome,sigla)')
    .eq('ativo', true)
    .order('nome', { ascending: true });

  if (profissional && !actorCanAdmin(actor)) {
    if (!profissional.servicoIds.length) return [];
    query = query.in('servico_id', profissional.servicoIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(normalizeModel);
}

async function contexto({ supabase, authUser, actor }) {
  const profissional = await getProfessionalByAuthUser(supabase, authUser?.id);
  const modelos = await listarModelosPermitidos(supabase, profissional, actor);

  return {
    profissional,
    podeCriar: Boolean(profissional?.ativo),
    podeAdministrar: actorCanAdmin(actor),
    modelos,
  };
}

async function buscarUsuarios({ supabase, termo, limit = 20 }) {
  const q = safeString(termo);
  if (q.length < 2) return { usuarios: [] };

  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
  const { data, error } = await supabase
    .from('sae_usuarios_resumo')
    .select('id,prontuario,nome,sexo,data_nascimento,idade')
    .or(`nome.ilike.%${q}%,prontuario.ilike.%${q}%`)
    .order('nome', { ascending: true })
    .limit(safeLimit);

  if (error) throw error;

  return {
    usuarios: (data || []).map((row) => ({
      id: safeString(row.id),
      prontuario: safeString(row.prontuario),
      nome: safeString(row.nome),
      sexo: safeString(row.sexo) || null,
      dataNascimento: safeString(row.data_nascimento) || null,
      idade: row.idade == null ? null : Number(row.idade),
    })),
  };
}

async function listarPorUsuario({ supabase, usuarioId }) {
  const usuario = await assertUserExists(supabase, usuarioId);

  const { data, error } = await supabase
    .from('sae_documentos')
    .select(`
      *,
      sae_modelos_documentos(nome,codigo),
      sae_profissionais(nome),
      sae_servicos(nome,sigla)
    `)
    .eq('usuario_id', usuario.id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return {
    usuario: {
      id: safeString(usuario.id),
      prontuario: safeString(usuario.prontuario),
      nome: safeString(usuario.nome),
    },
    documentos: (data || []).map(normalizeDocument),
  };
}

async function prefillUsuario(supabase, usuario) {
  const [cadastro, endereco, contatos] = await Promise.all([
    supabase.from('sae_usuarios').select('*').eq('id', usuario.id).maybeSingle(),
    supabase
      .from('sae_enderecos')
      .select('*')
      .eq('usuario_id', usuario.id)
      .order('principal', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('sae_contatos')
      .select('*')
      .eq('usuario_id', usuario.id)
      .order('principal', { ascending: false })
      .order('ordem', { ascending: true }),
  ]);

  if (cadastro.error) throw cadastro.error;
  if (endereco.error) throw endereco.error;
  if (contatos.error) throw contatos.error;

  const row = cadastro.data || {};
  const end = endereco.data || {};
  const contato = (contatos.data || [])[0] || {};

  return {
    nome: safeString(row.nome || usuario.nome),
    data_nascimento: safeString(row.data_nascimento || usuario.data_nascimento),
    idade_atual: row.idade ?? usuario.idade ?? '',
    sexo: safeString(row.sexo || usuario.sexo),
    nacionalidade: safeString(row.nacionalidade || usuario.nacionalidade),
    rg: safeString(row.rg_original || row.rg),
    cpf: safeString(row.cpf_original || row.cpf),
    telefone: safeString(contato.telefone_original || contato.telefone_normalizado || usuario.telefone_principal),
    endereco: safeString(end.logradouro || end.endereco_original || usuario.endereco_original),
    numero: safeString(end.numero),
    bairro: safeString(end.bairro || usuario.bairro),
    ponto_referencia: safeString(end.ponto_referencia),
    pessoa_contato: safeString(contato.nome_contato),
    fone_contato: safeString(contato.telefone_original || contato.telefone_normalizado),
  };
}

async function obterModelo(supabase, modeloId) {
  const { data, error } = await supabase
    .from('sae_modelos_documentos')
    .select('*,sae_servicos(id,nome,sigla)')
    .eq('id', safeString(modeloId))
    .eq('ativo', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError('Modelo de documento não encontrado ou inativo.', 404);
  return normalizeModel(data);
}

async function criar({ supabase, authUser, actor, usuarioId, payload }) {
  const profissional = await getProfessionalByAuthUser(supabase, authUser?.id);
  if (!profissional || !profissional.ativo) {
    throw createHttpError(
      'Seu login precisa estar vinculado a um profissional ativo do SAE para criar relatórios.',
      403,
    );
  }

  const usuario = await assertUserExists(supabase, usuarioId);
  const modelo = await obterModelo(supabase, payload?.modeloId);

  if (!profissional.servicoIds.includes(modelo.servicoId)) {
    throw createHttpError(
      'Este modelo pertence a um serviço que não está vinculado ao profissional logado.',
      403,
    );
  }

  const prefill = await prefillUsuario(supabase, usuario);
  const titulo = safeString(payload?.titulo) || modelo.nome;

  const { data, error } = await supabase
    .from('sae_documentos')
    .insert({
      usuario_id: usuario.id,
      modelo_id: modelo.id,
      profissional_id: profissional.id,
      servico_id: modelo.servicoId,
      titulo,
      status: 'RASCUNHO',
      dados: prefill,
      created_by: authUser.id,
    })
    .select('*')
    .single();

  if (error) throw error;

  return {
    documento: normalizeDocument(data),
    modelo,
    profissional,
  };
}

async function getDocumentoRaw(supabase, documentoId) {
  const { data, error } = await supabase
    .from('sae_documentos')
    .select('*')
    .eq('id', safeString(documentoId))
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError('Documento não encontrado.', 404);
  return data;
}

async function assertCanEditDocument({ supabase, authUser, actor, documento }) {
  if (actorCanAdmin(actor)) return;
  const profissional = await getProfessionalByAuthUser(supabase, authUser?.id);
  if (!profissional || profissional.id !== safeString(documento.profissional_id)) {
    throw createHttpError('Este documento pertence a outro profissional.', 403);
  }
}

async function atualizar({ supabase, authUser, actor, documentoId, payload }) {
  const atual = await getDocumentoRaw(supabase, documentoId);
  await assertCanEditDocument({ supabase, authUser, actor, documento: atual });

  if (safeString(atual.status) === 'ASSINADO') {
    throw createHttpError('Documento assinado não pode ser alterado.', 409);
  }

  const nextStatus = safeString(payload?.status || atual.status).toUpperCase();
  if (!['RASCUNHO', 'FINALIZADO'].includes(nextStatus)) {
    throw createHttpError('Status inválido para edição.', 400);
  }

  const dados =
    payload?.dados && typeof payload.dados === 'object'
      ? payload.dados
      : atual.dados || {};

  const update = {
    dados,
    titulo: safeString(payload?.titulo) || atual.titulo,
    status: nextStatus,
    updated_at: new Date().toISOString(),
    finalizado_at:
      nextStatus === 'FINALIZADO'
        ? atual.finalizado_at || new Date().toISOString()
        : null,
  };

  const { data, error } = await supabase
    .from('sae_documentos')
    .update(update)
    .eq('id', atual.id)
    .select('*')
    .single();

  if (error) throw error;
  return { documento: normalizeDocument(data) };
}

function formatDatePt(value) {
  const text = safeString(value);
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return text;
}

async function gerarDocx({ supabase, documentoId }) {
  const documento = await getDocumentoRaw(supabase, documentoId);

  const [modelo, profissionalResponse] = await Promise.all([
    obterModelo(supabase, documento.modelo_id),
    supabase
      .from('sae_profissionais')
      .select('id,nome,registro_profissional,conselho,cargo_funcao')
      .eq('id', documento.profissional_id)
      .maybeSingle(),
  ]);

  if (profissionalResponse.error) throw profissionalResponse.error;
  const profissional = profissionalResponse.data || {};

  if (modelo.codigo !== MODEL_CODE_SOCIAL) {
    throw createHttpError('Este modelo ainda não possui template DOCX configurado.', 501);
  }

  const templatePath = path.join(
    __dirname,
    '..',
    'templates',
    'sae',
    'servico_social_ficha_avaliacao.docx',
  );

  if (!fs.existsSync(templatePath)) {
    throw createHttpError('Template DOCX do Serviço Social não encontrado no backend.', 500);
  }

  const binary = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(binary);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter() {
      return '';
    },
  });

  const dados = documento.dados && typeof documento.dados === 'object' ? documento.dados : {};
  const context = {};

  for (const [key, value] of Object.entries(dados)) {
    context[String(key).toUpperCase()] = normalizeFieldValue(value);
  }

  context.DATA_NASCIMENTO = formatDatePt(context.DATA_NASCIMENTO);
  context.DATA_DOCUMENTO = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Boa_Vista',
  });
  context.PROFISSIONAL_NOME = safeString(profissional.nome);
  context.PROFISSIONAL_CARGO = safeString(profissional.cargo_funcao) || 'Assistente Social - CIAPI';
  context.PROFISSIONAL_REGISTRO = [profissional.conselho, profissional.registro_profissional]
    .map(safeString)
    .filter(Boolean)
    .join(' ');

  doc.render(context);

  const buffer = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  const filename = `${slugify(documento.titulo)}-${documento.id.slice(0, 8)}.docx`;
  return { buffer, filename };
}

function decodeBase64File(base64) {
  const raw = safeString(base64).replace(/^data:[^;]+;base64,/, '');
  if (!raw) throw createHttpError('Arquivo assinado não informado.', 400);

  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch (_) {
    throw createHttpError('Arquivo assinado inválido.', 400);
  }

  if (!buffer.length) throw createHttpError('Arquivo assinado vazio.', 400);
  if (buffer.length > 8 * 1024 * 1024) {
    throw createHttpError('O arquivo assinado deve ter no máximo 8 MB.', 413);
  }
  return buffer;
}

async function anexarAssinado({ supabase, authUser, actor, documentoId, payload }) {
  const documento = await getDocumentoRaw(supabase, documentoId);
  await assertCanEditDocument({ supabase, authUser, actor, documento });

  if (safeString(documento.status) === 'ASSINADO' || documento.arquivo_assinado_path) {
    throw createHttpError('Este documento já possui arquivo assinado anexado.', 409);
  }

  const mime = safeString(payload?.mime);
  const nome = safeString(payload?.nome);
  const allowed = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };

  const ext = allowed[mime];
  if (!ext) {
    throw createHttpError('Envie o documento assinado em PDF ou DOCX.', 400);
  }

  const buffer = decodeBase64File(payload?.base64);
  const ano = new Date().getFullYear();
  const pathStorage =
    `usuarios/${documento.usuario_id}/${documento.servico_id}/${ano}/${documento.id}/assinado.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(pathStorage, buffer, {
      contentType: mime,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('sae_documentos')
    .update({
      status: 'ASSINADO',
      arquivo_assinado_path: pathStorage,
      arquivo_assinado_nome: nome || `documento_assinado.${ext}`,
      arquivo_assinado_mime: mime,
      assinado_at: new Date().toISOString(),
      finalizado_at: documento.finalizado_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', documento.id)
    .select('*')
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([pathStorage]).catch(() => {});
    throw error;
  }

  return { documento: normalizeDocument(data) };
}

async function obterUrlAssinado({ supabase, documentoId }) {
  const documento = await getDocumentoRaw(supabase, documentoId);
  if (!documento.arquivo_assinado_path) {
    throw createHttpError('Este documento ainda não possui arquivo assinado.', 404);
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(documento.arquivo_assinado_path, 120, {
      download: documento.arquivo_assinado_nome || true,
    });

  if (error) throw error;

  return {
    url: data?.signedUrl,
    nome: documento.arquivo_assinado_nome,
    mime: documento.arquivo_assinado_mime,
  };
}

async function excluir({
  supabase,
  authUser,
  actor,
  documentoId,
}) {
  const documento = await getDocumentoRaw(supabase, documentoId);
  await assertCanEditDocument({
    supabase,
    authUser,
    actor,
    documento,
  });

  const status = safeString(documento.status).toUpperCase();

  if (status === 'ASSINADO' || documento.arquivo_assinado_path) {
    throw createHttpError(
      'Documento assinado não pode ser excluído. O arquivo deve permanecer no prontuário.',
      409,
    );
  }

  const { error } = await supabase
    .from('sae_documentos')
    .delete()
    .eq('id', documento.id);

  if (error) throw error;

  return { ok: true };
}

module.exports = {
  contexto,
  buscarUsuarios,
  listarPorUsuario,
  criar,
  atualizar,
  gerarDocx,
  anexarAssinado,
  obterUrlAssinado,
  excluir,
};
