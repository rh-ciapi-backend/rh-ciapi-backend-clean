function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalizeDateBR(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function detectLayout(rawRow, requestedLayout = 'automatico') {
  if (requestedLayout && requestedLayout !== 'automatico') return requestedLayout;

  const categoria = text(rawRow.categoria || rawRow.categoria_canonica).toUpperCase();

  if (categoria.includes('SESAU') && (rawRow.data_inicio_setor || rawRow.dataInicioSetor || rawRow.carga_horaria || rawRow.lotacao_interna)) {
    return 'sesau_detalhado';
  }

  if (categoria.includes('SESAU') && (rawRow.matricula_sigrh || rawRow.matriculaSigrh)) {
    return 'sesau_seletivo';
  }

  return 'setrabes_simples';
}

function normalizeLinhaMapa(rawRow, index = 0, requestedLayout = 'automatico') {
  const tipoLayout = detectLayout(rawRow, requestedLayout);
  const cpf = text(rawRow.cpf);
  const matricula = text(rawRow.matricula || rawRow.matricula_servidor || rawRow.servidor_matricula);
  const observacao = text(rawRow.observacao || rawRow.obs || rawRow.ocorrencia || rawRow.descricao || '');
  const inconsistencias = [];

  if (!text(rawRow.nome_completo || rawRow.nome || rawRow.servidor_nome)) inconsistencias.push('Nome ausente');
  if (!matricula) inconsistencias.push('Matrícula ausente');
  if (!cpf) inconsistencias.push('CPF ausente');
  if (!text(rawRow.cargo)) inconsistencias.push('Cargo ausente');
  if (!text(rawRow.setor)) inconsistencias.push('Setor ausente');
  if (tipoLayout === 'sesau_detalhado' && !text(rawRow.data_inicio_setor || rawRow.dataInicioSetor)) inconsistencias.push('Data início no setor ausente');
  if (tipoLayout === 'sesau_detalhado' && !text(rawRow.carga_horaria || rawRow.cargaHoraria)) inconsistencias.push('Carga horária ausente');
  if (tipoLayout === 'sesau_seletivo' && !text(rawRow.matricula_sigrh || rawRow.matriculaSigrh)) inconsistencias.push('Matrícula SIGRH ausente');

  return {
    ordem: Number(rawRow.ordem || index + 1),
    matricula,
    matriculaSigrh: text(rawRow.matricula_sigrh || rawRow.matriculaSigrh),
    nomeCompleto: text(rawRow.nome_completo || rawRow.nome || rawRow.servidor_nome, 'NÃO INFORMADO'),
    cpf,
    cargo: text(rawRow.cargo, 'NÃO INFORMADO'),
    categoria: text(rawRow.categoria || rawRow.categoria_canonica, 'NÃO INFORMADO'),
    setor: text(rawRow.setor, 'NÃO INFORMADO'),
    lotacao: text(rawRow.lotacao || rawRow.setor, ''),
    lotacaoInterna: text(rawRow.lotacao_interna || rawRow.lotacaoInterna),
    frequenciaTexto: text(rawRow.frequencia_texto || rawRow.frequencia || rawRow.freq, 'INTEGRAL'),
    faltas: text(rawRow.faltas, '-'),
    observacao,
    dataInicioSetor: normalizeDateBR(rawRow.data_inicio_setor || rawRow.dataInicioSetor),
    cargaHoraria: text(rawRow.carga_horaria || rawRow.cargaHoraria),
    status: text(rawRow.status, 'ATIVO'),
    tipoLayout,
    inconsistencias,
    _cpfDigits: onlyDigits(cpf),
    _matriculaDigits: onlyDigits(matricula),
  };
}

module.exports = {
  normalizeLinhaMapa,
  detectLayout,
  normalizeDateBR,
};
