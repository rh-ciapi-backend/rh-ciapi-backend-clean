const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

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
      .replace(/(^-|-$)/g, '') || 'mapa'
  );
}

function formatDatePt(value) {
  const text = safeString(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

function getDateValue(row) {
  return (
    safeString(row.data) ||
    safeString(row.data_atendimento) ||
    safeString(row.atendido_em).slice(0, 10) ||
    safeString(row.created_at).slice(0, 10)
  );
}

function getObservation(row) {
  return (
    safeString(row.observacao) ||
    safeString(row.evolucao) ||
    safeString(row.descricao) ||
    safeString(row.registro) ||
    ''
  );
}

async function getProfessionalByAuthUser(supabase, authUserId) {
  const id = safeString(authUserId);
  if (!id) return null;

  const { data, error } = await supabase
    .from('sae_profissionais')
    .select('id,auth_user_id,nome,cargo_funcao,registro_profissional,conselho,ativo')
    .eq('auth_user_id', id)
    .limit(2);

  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return null;
  if (rows.length > 1) {
    throw createHttpError('Este login está vinculado a mais de um profissional do SAE.', 409);
  }

  const profissional = rows[0];

  const { data: vinculos, error: vinculosError } = await supabase
    .from('sae_profissional_servicos')
    .select('servico_id,ativo')
    .eq('profissional_id', profissional.id)
    .eq('ativo', true);

  if (vinculosError) throw vinculosError;

  const servicoIds = (vinculos || [])
    .map((item) => safeString(item.servico_id))
    .filter(Boolean);

  let servicos = [];
  if (servicoIds.length) {
    const { data: servicosData, error: servicosError } = await supabase
      .from('sae_servicos')
      .select('id,nome,sigla,ativo')
      .in('id', servicoIds)
      .eq('ativo', true)
      .order('nome', { ascending: true });

    if (servicosError) throw servicosError;
    servicos = servicosData || [];
  }

  return {
    id: safeString(profissional.id),
    nome: safeString(profissional.nome),
    cargoFuncao: safeString(profissional.cargo_funcao),
    registroProfissional: safeString(profissional.registro_profissional),
    conselho: safeString(profissional.conselho),
    ativo: Boolean(profissional.ativo),
    servicos: servicos.map((item) => ({
      id: safeString(item.id),
      nome: safeString(item.nome),
      sigla: safeString(item.sigla),
    })),
  };
}

async function listar({ supabase, authUser, mes, ano, servicoId }) {
  const profissional = await getProfessionalByAuthUser(supabase, authUser?.id);
  if (!profissional || !profissional.ativo) {
    throw createHttpError(
      'Seu login precisa estar vinculado a um profissional ativo para acessar o mapa.',
      403,
    );
  }

  const safeAno = Number(ano);
  const safeMes = Number(mes);
  if (!Number.isInteger(safeAno) || safeAno < 2000 || safeAno > 2100) {
    throw createHttpError('Ano inválido.', 400);
  }
  if (!Number.isInteger(safeMes) || safeMes < 1 || safeMes > 12) {
    throw createHttpError('Mês inválido.', 400);
  }

  let query = supabase
    .from('sae_atendimentos')
    .select('*')
    .eq('profissional_id', profissional.id);

  if (servicoId) {
    query = query.eq('servico_id', safeString(servicoId));
  }

  const { data: atendimentosData, error } = await query;
  if (error) throw error;

  const rows = (atendimentosData || []).filter((row) => {
    const date = getDateValue(row);
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match && Number(match[1]) === safeAno && Number(match[2]) === safeMes;
  });

  const usuarioIds = Array.from(
    new Set(rows.map((row) => safeString(row.usuario_id)).filter(Boolean)),
  );

  let usuarios = [];
  if (usuarioIds.length) {
    const { data, error: usuariosError } = await supabase
      .from('sae_usuarios_resumo')
      .select('id,prontuario,nome,sexo,data_nascimento,idade,turno')
      .in('id', usuarioIds);

    if (usuariosError) throw usuariosError;
    usuarios = data || [];
  }

  const usuariosMap = new Map(
    usuarios.map((item) => [safeString(item.id), item]),
  );

  const itens = rows
    .map((row) => {
      const usuario = usuariosMap.get(safeString(row.usuario_id)) || {};
      return {
        id: safeString(row.id),
        data: getDateValue(row),
        prontuario: safeString(usuario.prontuario),
        nome: safeString(usuario.nome) || safeString(row.nome_usuario) || 'Não informado',
        sexo: safeString(usuario.sexo),
        idade:
          usuario.idade == null
            ? ''
            : String(usuario.idade),
        turno: safeString(usuario.turno),
        observacao: getObservation(row),
        servicoId: safeString(row.servico_id),
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data) || a.nome.localeCompare(b.nome));

  const turnos = Array.from(new Set(itens.map((item) => item.turno).filter(Boolean)));

  return {
    profissional,
    mes: safeMes,
    ano: safeAno,
    servicoId: safeString(servicoId) || null,
    turno: turnos.length === 1 ? turnos[0] : turnos.length > 1 ? 'MISTO' : '',
    total: itens.length,
    itens,
  };
}

async function gerarDocx({ supabase, authUser, mes, ano, servicoId }) {
  const mapa = await listar({ supabase, authUser, mes, ano, servicoId });

  const templateCandidates = [
    path.join(__dirname, '..', 'templates', 'sae', 'mapa_atendimento_profissional.docx'),
    path.join(process.cwd(), 'src', 'templates', 'sae', 'mapa_atendimento_profissional.docx'),
    path.join(process.cwd(), 'backend', 'src', 'templates', 'sae', 'mapa_atendimento_profissional.docx'),
  ];

  const templatePath = templateCandidates.find((candidate) => fs.existsSync(candidate));
  if (!templatePath) {
    throw createHttpError(
      `Template do Mapa de Atendimento não encontrado. Caminhos verificados: ${templateCandidates.join(' | ')}`,
      500,
    );
  }

  const servico =
    mapa.profissional.servicos.find((item) => item.id === mapa.servicoId) ||
    mapa.profissional.servicos[0] ||
    {};

  const meses = [
    '', 'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
  ];

  const context = {
    SETOR: safeString(servico.nome) || 'SAE',
    PROFISSIONAL: mapa.profissional.nome,
    TURNO: mapa.turno || '',
    MES: meses[mapa.mes] || String(mapa.mes),
    ANO: String(mapa.ano),
  };

  for (let i = 1; i <= 28; i += 1) {
    const item = mapa.itens[i - 1] || {};
    context[`DATA_${i}`] = formatDatePt(item.data);
    context[`PRONTUARIO_${i}`] = safeString(item.prontuario);
    context[`NOME_${i}`] = safeString(item.nome);
    context[`SEXO_${i}`] = safeString(item.sexo);
    context[`IDADE_${i}`] = safeString(item.idade);
    context[`OBSERVACAO_${i}`] = safeString(item.observacao);
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
  doc.render(context);

  const buffer = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  return {
    buffer,
    filename: `mapa-atendimento-${slugify(mapa.profissional.nome)}-${mapa.ano}-${String(mapa.mes).padStart(2, '0')}.docx`,
    total: mapa.total,
    truncated: mapa.total > 28,
  };
}

module.exports = {
  listar,
  gerarDocx,
};
