const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const OPCOES = {
  'Certidão de tempo de serviço e ficha financeira': 'CERTIDAO DE TEMPO DE SERVICO E FICHA FINANCEIRA',
  'Pagamento de verbas rescisórias': 'PAGAMENTO DE VERBAS RESCISORIAS',
  'Averbação de tempo de contribuição': 'AVERBACAO DE TEMPO DE CONTRIBUICAO',
  Vacância: 'VACANCIA A PARTIR DE',
  Exoneração: 'EXONERACAO',
  'Licença para atividade política': 'LICENCA PARA ATIVIDADE POLITICA',
  'Licença para capacitação': 'LICENCA PARA CAPACITACAO',
  'Licença para cursar pós-graduação': 'LICENCA PARA CURSAR POS GRADUACAO',
  'Licença para desempenho de mandato classista': 'LICENCA PARA DESEMPENHO DE MANDATO CLASSISTA',
  'Licença para o serviço militar': 'LICENCA PARA O SERVICO MILITAR',
  'Licença para tratar de interesse particular': 'LICENCA PARA TRATAR DE INTERESSE PARTICULAR',
  'Licença por doença em pessoa da família': 'LICENCA POR MOTIVO DE DOENCA EM PESSOA DA FAMILIA',
  'Licença por afastamento do cônjuge ou companheiro(a)': 'LICENCA POR MOTIVO DO AFASTAMENTO DO CONJUGE',
  'Licença para tratamento da própria saúde': 'LICENCA PARA TRATAMENTO DE SAUDE PROPRIA',
  'Licença por acidente em serviço': 'LICENCA POR ACIDENTE EM SERVICO',
  'Licença à gestante': 'LICENCA A GESTANTE',
  'Auxílio natalidade': 'AUXILIO NATALIDADE',
  'Salário família': 'SALARIO FAMILIA',
};

const CAMPOS = {
  N: 'nome', NA: 'nacionalidade', EC: 'estadoCivil', CPF: 'cpf',
  RG: 'rg', OE: 'orgaoExpedidor', DE: 'dataExpedicao', P: 'pasep',
  TE: 'tituloEleitor', DN: 'dataNascimento', PA: 'pai', MA: 'mae',
  CA: 'cargo', MT: 'matricula', FU: 'funcao', CL: 'classe',
  LO: 'lotacao', UE: 'unidadeExercicio', EN: 'endereco',
  NU: 'numero', CO: 'complemento', BA: 'bairro', CEP: 'cep',
  MU: 'municipio', UF: 'uf', TT: 'telefoneTrabalho',
  TR: 'telefoneResidencial', CE: 'celular',
};

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function xmlSeguro(valor) {
  return String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function dataBR(valor) {
  const texto = String(valor || '');
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : texto;
}

function localizarModelo() {
  const candidatos = [
    path.join(__dirname, '../../templates/modelo_requerimento_servidor.docx'),
    path.join(__dirname, '../../modelos/modelo_requerimento_servidor.docx'),
  ];
  const arquivo = candidatos.find((candidato) => fs.existsSync(candidato));
  if (!arquivo) throw new Error('Modelo Word do requerimento não encontrado.');
  return arquivo;
}

function gerarRequerimentoDocx(requerimento) {
  const tipo = String(requerimento?.tipo || '');
  const marcador = OPCOES[tipo];
  if (!marcador && tipo !== 'Outra solicitação') {
    throw new Error('Tipo de requerimento não reconhecido pelo modelo Word.');
  }

  const zip = new PizZip(fs.readFileSync(localizarModelo()));
  const documento = zip.file('word/document.xml');
  if (!documento) throw new Error('Modelo Word inválido.');
  let xml = documento.asText();

  if (marcador) {
    let encontrados = 0;
    xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragrafo) => {
      const texto = [...paragrafo.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((item) => item[1]).join('');
      if (!normalizar(texto).includes(marcador)) return paragrafo;

      const alterado = paragrafo.replace(
        /(<w:t\b[^>]*>)\(\s*(<\/w:t>)/,
        '$1(X$2'
      );
      if (alterado !== paragrafo) encontrados += 1;
      return alterado;
    });
    if (encontrados !== 1) {
      throw new Error('Não foi possível marcar o pedido no modelo Word.');
    }
  }

  const dados = requerimento.dados_snapshot || {};
  const data = new Date(requerimento.criado_em);
  if (Number.isNaN(data.getTime())) {
    throw new Error('Data do requerimento inválida.');
  }

  const partes = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Boa_Vista',
  }).formatToParts(data);
  const componente = (nome) =>
    partes.find((parte) => parte.type === nome)?.value || '';

  const valores = {
    DT: requerimento.detalhes || '',
    DI: componente('day'),
    ME: componente('month'),
    AN: componente('year'),
  };

  const regime = normalizar(dados.regime);
  const situacao = normalizar(dados.situacao);
  const exonerado = situacao === 'EXONERADO';

  Object.assign(valores, {
    EF: regime === 'EFETIVO' ? 'X' : '',
    CC: regime === 'CARGO COMISSIONADO' || regime === 'COMISSIONADO' ? 'X' : '',
    TP: regime === 'TEMPORARIO' ? 'X' : '',
    AT: situacao === 'ATIVO' ? 'X' : '',
    IN: situacao === 'INATIVO' ? 'X' : '',
    PE: situacao === 'PENSIONISTA' ? 'X' : '',
    EXN: situacao && !exonerado ? 'X' : '',
    EXS: exonerado ? 'X' : '',
    ED: dataBR(dados.dataExoneracao),
  });

  for (const [marcadorCampo, nomeCampo] of Object.entries(CAMPOS)) {
    valores[marcadorCampo] = nomeCampo.startsWith('data')
      ? dataBR(dados[nomeCampo])
      : dados[nomeCampo] || '';
  }

  for (const [chave, valor] of Object.entries(valores)) {
    const token = `{{${chave}}}`;
    if (!xml.includes(token)) {
      throw new Error(`Campo ${token} ausente no modelo Word.`);
    }
    xml = xml.split(token).join(xmlSeguro(valor));
  }

  zip.file('word/document.xml', xml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { gerarRequerimentoDocx };
