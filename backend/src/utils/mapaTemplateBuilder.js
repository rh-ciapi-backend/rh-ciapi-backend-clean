function monthNamePtBr(mes) {
  return [
    'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
  ][Number(mes) - 1] || '';
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildSimplePageContext(linhas, meta) {
  const ctx = {
    CATEGORIA: meta.categoriaTitulo || 'SERVIDORES',
    LOTACAO: meta.lotacao || 'CENTRO DE REFERÊNCIA DO IDOSO – MELHOR IDADE/SETRABES',
    MES_EXT: monthNamePtBr(meta.mes),
    ANO: String(meta.ano),
    DIA: String(meta.dia || new Date().getDate()).padStart(2, '0'),
  };

  for (let i = 1; i <= 13; i += 1) {
    const linha = linhas[i - 1];
    ctx[`N_${i}`] = linha?.ordem ? String(linha.ordem).padStart(2, '0') : '';
    ctx[`MAT_${i}`] = linha?.matricula || '-';
    ctx[`NOME_${i}`] = linha?.nomeCompleto || '';
    ctx[`CPF_${i}`] = linha?.cpf || '-';
    ctx[`CARGO_${i}`] = linha?.cargo || '-';
    ctx[`FREQ_${i}`] = linha?.frequenciaTexto || 'INTEGRAL';
    ctx[`FALTAS_${i}`] = linha?.faltas || '-';
    ctx[`OBS_${i}`] = linha?.observacao || '-';
  }

  return ctx;
}

function buildMapaTemplatePages(preview) {
  const linhas = preview.linhas || [];
  const grupos = chunkArray(linhas, 13);
  return grupos.map((grupo) => buildSimplePageContext(grupo, {
    mes: preview.filtros.mes,
    ano: preview.filtros.ano,
    dia: new Date().getDate(),
    categoriaTitulo: preview.filtros.categoria || preview.layout.toUpperCase(),
    lotacao: preview.filtros.setor || 'CENTRO DE REFERÊNCIA DO IDOSO – MELHOR IDADE/SETRABES',
  }));
}

module.exports = {
  buildMapaTemplatePages,
  monthNamePtBr,
};
