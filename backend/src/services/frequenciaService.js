function onlyNumbers(value) {
  return String(value || "").replace(/\D/g, "");
}

function toIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function getDaysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function normalizeTipo(tipo) {
  const raw = String(tipo || "").trim().toUpperCase();
  if (raw === "FALTA") return "FALTA";
  if (raw === "ATESTADO") return "ATESTADO";
  if (raw === "FERIADO") return "FERIADO";
  if (raw === "PONTO") return "PONTO";
  if (raw === "PONTO FACULTATIVO") return "PONTO FACULTATIVO";
  if (raw === "FÉRIAS" || raw === "FERIAS") return "FERIAS";
  if (raw === "ANIVERSÁRIO" || raw === "ANIVERSARIO") return "ANIVERSARIO";
  return raw || "EVENTO";
}

async function listarServidores(supabase, servidorCpf) {
  let query = supabase.from("servidores").select("*").order("nome", { ascending: true });

  if (servidorCpf) {
    const cpf = onlyNumbers(servidorCpf);
    query = query.eq("cpf", cpf);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao listar servidores: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

async function listarOcorrencias(supabase, ano, mes, servidorCpf) {
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const fim = `${ano}-${String(mes).padStart(2, "0")}-${String(getDaysInMonth(ano, mes)).padStart(2, "0")}`;

  let query = supabase
    .from("faltas")
    .select("*")
    .gte("data", inicio)
    .lte("data", fim);

  if (servidorCpf) {
    query = query.eq("cpf", onlyNumbers(servidorCpf));
  }

  const { data, error } = await query;
  if (error) {
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function listarEventos(supabase, ano, mes) {
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const fim = `${ano}-${String(mes).padStart(2, "0")}-${String(getDaysInMonth(ano, mes)).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("eventos")
    .select("*")
    .gte("data", inicio)
    .lte("data", fim);

  if (error) {
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function listarFerias(supabase, servidorCpf) {
  let query = supabase.from("ferias").select("*");

  if (servidorCpf) {
    query = query.eq("servidor_cpf", onlyNumbers(servidorCpf));
  }

  const { data, error } = await query;
  if (error) {
    return [];
  }

  return Array.isArray(data) ? data : [];
}

function buildMonthData({ ano, mes, servidores, ocorrencias, eventos, ferias }) {
  const diasNoMes = getDaysInMonth(ano, mes);

  return servidores.map((servidor) => {
    const cpf = onlyNumbers(servidor.cpf);
    const itens = [];

    for (let dia = 1; dia <= diasNoMes; dia += 1) {
      const dataIso = toIsoDate(ano, mes, dia);

      const ocorrenciasDia = ocorrencias.filter((o) => onlyNumbers(o.cpf) === cpf && String(o.data).slice(0, 10) === dataIso);
      const eventosDia = eventos.filter((e) => String(e.data).slice(0, 10) === dataIso);

      const feriasDia = ferias.some((f) => {
        if (onlyNumbers(f.servidor_cpf) !== cpf) return false;

        const periodos = [
          [f.periodo1_inicio, f.periodo1_fim],
          [f.periodo2_inicio, f.periodo2_fim],
          [f.periodo3_inicio, f.periodo3_fim],
        ];

        return periodos.some(([ini, fim]) => {
          if (!ini || !fim) return false;
          const d = dataIso;
          return d >= String(ini).slice(0, 10) && d <= String(fim).slice(0, 10);
        });
      });

      itens.push({
        dia,
        data: dataIso,
        ocorrencias: ocorrenciasDia.map((o) => ({
          id: o.id || null,
          tipo: normalizeTipo(o.tipo),
          turno: o.turno || "",
          observacao: o.observacao || "",
        })),
        eventos: eventosDia.map((e) => ({
          id: e.id || null,
          tipo: normalizeTipo(e.tipo),
          titulo: e.titulo || e.nome || "",
          descricao: e.descricao || "",
        })),
        ferias: feriasDia,
      });
    }

    return {
      servidor: {
        id: servidor.id || servidor.servidor || null,
        nome: servidor.nome || servidor.nome_completo || "",
        cpf,
        matricula: servidor.matricula || "",
        cargo: servidor.cargo || "",
        categoria: servidor.categoria || "",
        setor: servidor.setor || "",
        status: servidor.status || "ATIVO",
      },
      dias: itens,
    };
  });
}

async function listarFrequenciaMensal({ supabase, ano, mes, servidorCpf }) {
  if (!supabase) {
    throw new Error("Cliente Supabase não disponível.");
  }

  if (!ano || !mes) {
    throw new Error("Parâmetros ano e mes são obrigatórios.");
  }

  const servidores = await listarServidores(supabase, servidorCpf);
  const ocorrencias = await listarOcorrencias(supabase, ano, mes, servidorCpf);
  const eventos = await listarEventos(supabase, ano, mes);
  const ferias = await listarFerias(supabase, servidorCpf);

  return buildMonthData({
    ano,
    mes,
    servidores,
    ocorrencias,
    eventos,
    ferias,
  });
}

async function registrarOcorrenciaFrequencia({ supabase, payload }) {
  if (!supabase) throw new Error("Cliente Supabase não disponível.");

  const row = {
    cpf: onlyNumbers(payload.cpf),
    data: payload.data,
    tipo: normalizeTipo(payload.tipo),
    turno: payload.turno || null,
    observacao: payload.observacao || null,
  };

  const { data, error } = await supabase.from("faltas").insert(row).select().single();

  if (error) throw new Error(`Erro ao registrar ocorrência: ${error.message}`);
  return data;
}

async function editarOcorrenciaFrequencia({ supabase, id, payload }) {
  if (!supabase) throw new Error("Cliente Supabase não disponível.");

  const row = {
    cpf: payload.cpf ? onlyNumbers(payload.cpf) : undefined,
    data: payload.data,
    tipo: payload.tipo ? normalizeTipo(payload.tipo) : undefined,
    turno: payload.turno,
    observacao: payload.observacao,
  };

  Object.keys(row).forEach((key) => row[key] === undefined && delete row[key]);

  const { data, error } = await supabase
    .from("faltas")
    .update(row)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`Erro ao editar ocorrência: ${error.message}`);
  return data;
}

async function excluirOcorrenciaFrequencia({ supabase, id }) {
  if (!supabase) throw new Error("Cliente Supabase não disponível.");

  const { error } = await supabase.from("faltas").delete().eq("id", id);

  if (error) throw new Error(`Erro ao excluir ocorrência: ${error.message}`);
  return { id };
}

module.exports = {
  listarFrequenciaMensal,
  registrarOcorrenciaFrequencia,
  editarOcorrenciaFrequencia,
  excluirOcorrenciaFrequencia,
};
