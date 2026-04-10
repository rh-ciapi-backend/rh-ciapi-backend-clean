function buildMapaDiagnostics(linhas = []) {
  const cpfCount = new Map();
  const matriculaCount = new Map();

  linhas.forEach((linha) => {
    if (linha?._cpfDigits) {
      cpfCount.set(linha._cpfDigits, (cpfCount.get(linha._cpfDigits) || 0) + 1);
    }
    if (linha?._matriculaDigits) {
      matriculaCount.set(
        linha._matriculaDigits,
        (matriculaCount.get(linha._matriculaDigits) || 0) + 1
      );
    }
  });

  const registrosInvalidos = [];
  let totalComCpfAusente = 0;
  let totalComMatriculaAusente = 0;
  let totalComCargoAusente = 0;
  let totalComObservacao = 0;
  let totalComObservacaoLonga = 0;
  let totalComPendenciaGrave = 0;

  for (const linha of linhas) {
    const motivos = Array.isArray(linha?.inconsistencias)
      ? [...linha.inconsistencias]
      : [];

    if (!linha?.cpf) totalComCpfAusente += 1;
    if (!linha?.matricula) totalComMatriculaAusente += 1;
    if (!linha?.cargo || linha.cargo === 'NÃO INFORMADO') totalComCargoAusente += 1;
    if (linha?.observacao) totalComObservacao += 1;

    if (String(linha?.observacao || '').length >= 90) {
      totalComObservacaoLonga += 1;
      if (!motivos.includes('Observação longa pode quebrar o layout')) {
        motivos.push('Observação longa pode quebrar o layout');
      }
    }

    if (linha?._cpfDigits && (cpfCount.get(linha._cpfDigits) || 0) > 1) {
      if (!motivos.includes('CPF duplicado')) motivos.push('CPF duplicado');
    }

    if (linha?._matriculaDigits && (matriculaCount.get(linha._matriculaDigits) || 0) > 1) {
      if (!motivos.includes('Matrícula duplicada')) motivos.push('Matrícula duplicada');
    }

    const hasGrave = motivos.some((item) =>
      [
        'CPF ausente',
        'Matrícula ausente',
        'CPF duplicado',
        'Matrícula duplicada',
        'Nome ausente',
      ].includes(item)
    );

    if (hasGrave) totalComPendenciaGrave += 1;

    if (motivos.length) {
      registrosInvalidos.push({
        ordem: linha?.ordem,
        nomeCompleto: linha?.nomeCompleto,
        matricula: linha?.matricula,
        cpf: linha?.cpf,
        motivos,
      });
    }
  }

  const totalComDuplicidadeCpf = Array.from(cpfCount.values()).filter((n) => n > 1).length;
  const totalComDuplicidadeMatricula = Array.from(matriculaCount.values()).filter((n) => n > 1).length;
  const paginasPrevistas = Math.max(1, Math.ceil((linhas.length || 1) / 13));

  const alertas = [];
  const sugestoes = [];

  if (totalComCpfAusente) alertas.push(`Existem ${totalComCpfAusente} registro(s) sem CPF.`);
  if (totalComMatriculaAusente) alertas.push(`Existem ${totalComMatriculaAusente} registro(s) sem matrícula.`);
  if (totalComCargoAusente) alertas.push(`Existem ${totalComCargoAusente} registro(s) sem cargo definido.`);
  if (totalComDuplicidadeCpf) alertas.push('Foram detectados CPFs duplicados no conjunto do mapa.');
  if (totalComDuplicidadeMatricula) alertas.push('Foram detectadas matrículas duplicadas no conjunto do mapa.');
  if (totalComObservacaoLonga) alertas.push('Há observações extensas que podem exigir quebra de página ou ajuste do layout.');
  if (paginasPrevistas > 1) alertas.push('A exportação prevista exigirá múltiplas páginas.');

  if (totalComPendenciaGrave) sugestoes.push('Revise os registros inválidos antes de exportar o documento oficial.');
  if (totalComObservacaoLonga) sugestoes.push('Avalie resumir observações muito longas ou usar um layout mais amplo.');
  if (!totalComPendenciaGrave) sugestoes.push('Os dados estão aptos para exportação documental.');

  return {
    totalRegistros: linhas.length,
    totalComCpfAusente,
    totalComMatriculaAusente,
    totalComCargoAusente,
    totalComDuplicidadeCpf,
    totalComDuplicidadeMatricula,
    totalComObservacao,
    totalComObservacaoLonga,
    totalComPendenciaGrave,
    paginasPrevistas,
    registrosInvalidos,
    alertas,
    sugestoes,
  };
}

module.exports = { buildMapaDiagnostics };
