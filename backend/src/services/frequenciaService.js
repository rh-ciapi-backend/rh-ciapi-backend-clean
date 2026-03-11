import { OcorrenciaFrequencia } from '../types';
import { MOCK_FREQUENCIA } from '../data/frequencia';
import { API_CONFIG, fetchJson } from '../config/api';
import { supabase } from '../lib/supabaseClient';
import { ListarFrequenciaParams } from './apiTypes';
import { logsService } from './logsService';

type RegistrarOcorrenciaInput = {
  servidorId?: string;
  servidorCpf?: string;
  data: string;
  tipo: string;
  turno?: string;
  descricao?: string;
};

type ExportarFrequenciaInput = {
  servidorId: string;
  mes: number;
  ano: number;
  incluirPonto?: boolean;
};

type ApiListResponse<T> =
  | T[]
  | {
      ok?: boolean;
      data?: T[];
      error?: string;
      message?: string;
    };

type ApiItemResponse<T> =
  | T
  | {
      ok?: boolean;
      data?: T;
      error?: string;
      message?: string;
    };

let frequenciaMock = Array.isArray(MOCK_FREQUENCIA) ? [...MOCK_FREQUENCIA] : [];

const normalizeString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const onlyDigits = (value: unknown): string => {
  return String(value || '').replace(/\D/g, '');
};

const normalizeDate = (value: unknown): string => {
  const raw = normalizeString(value);
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildMonthRange = (ano: number, mes: number) => {
  const month = String(mes).padStart(2, '0');
  const startDate = `${ano}-${month}-01`;
  const lastDay = new Date(ano, mes, 0).getDate();
  const endDate = `${ano}-${month}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
};

const mapFromDB = (data: any): OcorrenciaFrequencia => ({
  id: data?.id,
  servidorId:
    data?.servidor_id ??
    data?.servidorId ??
    data?.servidor ??
    '',
  data: normalizeDate(data?.data),
  tipo: normalizeString(data?.tipo ?? data?.ocorrencia).toUpperCase(),
  turno: normalizeString(data?.turno || 'INTEGRAL').toUpperCase(),
  descricao: normalizeString(data?.descricao ?? data?.observacao),
});

const mapToDB = (data: Partial<OcorrenciaFrequencia> | RegistrarOcorrenciaInput) => {
  const servidorId = normalizeString((data as any)?.servidorId);
  const servidorCpf = onlyDigits((data as any)?.servidorCpf);

  const payload: Record<string, any> = {
    data: normalizeDate((data as any)?.data),
    tipo: normalizeString((data as any)?.tipo).toUpperCase(),
    turno: normalizeString((data as any)?.turno || 'INTEGRAL').toUpperCase(),
    descricao: normalizeString((data as any)?.descricao),
  };

  if (servidorId) payload.servidor_id = servidorId;
  if (servidorCpf) payload.servidor_cpf = servidorCpf;

  return payload;
};

const unwrapListResponse = <T>(response: ApiListResponse<T>): T[] => {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.data)) return response.data;
  return [];
};

const unwrapItemResponse = <T>(response: ApiItemResponse<T>): T => {
  if (response && typeof response === 'object' && 'data' in response && response.data) {
    return response.data;
  }
  return response as T;
};

const getApiBaseUrl = (): string => {
  return (
    (API_CONFIG as any)?.baseUrl ||
    (API_CONFIG as any)?.apiBaseUrl ||
    (API_CONFIG as any)?.backendURL ||
    (API_CONFIG as any)?.backendUrl ||
    ''
  );
};

const downloadBlob = (blob: Blob, fileName: string) => {
  if (typeof window === 'undefined') return;

  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

const buildExportFileName = (ext: 'docx' | 'pdf' | 'csv', params: ExportarFrequenciaInput) => {
  const mes = String(params.mes).padStart(2, '0');
  return `frequencia_${params.ano}_${mes}_${params.servidorId}.${ext}`;
};

const registrarLog = async (
  acao: 'CRIAR' | 'EDITAR' | 'EXCLUIR' | 'EXPORTAR',
  entidadeId: string,
  detalhes: Record<string, any>,
) => {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await logsService.registrar({
      user_id: user?.id || 'sistema',
      user_email: user?.email,
      acao,
      entidade: 'FREQUENCIA',
      entidade_id: entidadeId,
      detalhes,
    });
  } catch (error) {
    console.warn('[frequenciaService] Falha ao registrar log:', error);
  }
};

const tentarExportarViaApi = async (
  formato: 'docx' | 'pdf' | 'csv',
  params: ExportarFrequenciaInput,
) => {
  const endpoint = `/api/frequencia/exportar/${formato}`;
  const payload = {
    servidorId: params.servidorId,
    mes: params.mes,
    ano: params.ano,
    incluirPonto: !!params.incluirPonto,
  };

  const apiBase = getApiBaseUrl();
  const url = `${String(apiBase || '').replace(/\/$/, '')}${endpoint}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = `Falha ao exportar ${formato.toUpperCase()}.`;
    try {
      const json = await response.json();
      message = json?.error || json?.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const json = await response.json();

    if (json?.downloadUrl && typeof window !== 'undefined') {
      window.open(json.downloadUrl, '_blank');
      return;
    }

    if (json?.url && typeof window !== 'undefined') {
      window.open(json.url, '_blank');
      return;
    }

    if (json?.ok) return;

    throw new Error(json?.error || `Exportação ${formato.toUpperCase()} retornou resposta inesperada.`);
  }

  const blob = await response.blob();
  downloadBlob(blob, buildExportFileName(formato, params));
};

export const apiFrequencia = {
  listar: async (filtros?: ListarFrequenciaParams): Promise<OcorrenciaFrequencia[]> => {
    if (API_CONFIG.useMock) {
      let result = [...frequenciaMock];

      if (filtros?.servidorId) {
        result = result.filter((f) => f.servidorId === filtros.servidorId);
      }

      if (filtros?.ano && filtros?.mes) {
        const prefix = `${filtros.ano}-${String(filtros.mes).padStart(2, '0')}`;
        result = result.filter((f) => normalizeDate(f.data).startsWith(prefix));
      }

      return result
        .map(mapFromDB)
        .sort((a, b) => normalizeDate(a.data).localeCompare(normalizeDate(b.data)));
    }

    try {
      const queryParams = new URLSearchParams();

      if (filtros?.servidorId) queryParams.append('servidorId', filtros.servidorId);
      if ((filtros as any)?.servidorCpf) queryParams.append('servidorCpf', onlyDigits((filtros as any).servidorCpf));
      if (filtros?.ano) queryParams.append('ano', String(filtros.ano));
      if (filtros?.mes) queryParams.append('mes', String(filtros.mes));

      const queryString = queryParams.toString();
      const response = await fetchJson<ApiListResponse<any>>(
        `/api/frequencia${queryString ? `?${queryString}` : ''}`
      );

      return unwrapListResponse(response).map(mapFromDB);
    } catch (error) {
      console.warn('[frequenciaService] Falha ao buscar da API, tentando Supabase diretamente...', error);

      let query = supabase.from('frequencia').select('*');

      if (filtros?.servidorId) {
        query = query.eq('servidor_id', filtros.servidorId);
      }

      if ((filtros as any)?.servidorCpf) {
        query = query.eq('servidor_cpf', onlyDigits((filtros as any).servidorCpf));
      }

      if (filtros?.ano && filtros?.mes) {
        const { startDate, endDate } = buildMonthRange(filtros.ano, filtros.mes);
        query = query.gte('data', startDate).lte('data', endDate);
      }

      const { data, error: sbError } = await query.order('data', { ascending: true });

      if (sbError) throw sbError;

      return (data || []).map(mapFromDB);
    }
  },

  listarPorMes: async (ano: number, mes: number, servidorId?: string): Promise<OcorrenciaFrequencia[]> => {
    return apiFrequencia.listar({
      ano,
      mes,
      servidorId,
    });
  },

  obterPorId: async (id: string): Promise<OcorrenciaFrequencia> => {
    if (API_CONFIG.useMock) {
      const item = frequenciaMock.find((f) => f.id === id);
      if (!item) throw new Error('Ocorrência não encontrada');
      return mapFromDB(item);
    }

    try {
      const response = await fetchJson<ApiItemResponse<any>>(`/api/frequencia/${id}`);
      return mapFromDB(unwrapItemResponse(response));
    } catch {
      const { data, error } = await supabase
        .from('frequencia')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return mapFromDB(data);
    }
  },

  adicionar: async (dados: Omit<OcorrenciaFrequencia, 'id'>): Promise<OcorrenciaFrequencia> => {
    const payload = mapToDB(dados);

    if (!payload.servidor_id && !payload.servidor_cpf) {
      throw new Error('Servidor é obrigatório.');
    }

    if (!payload.data) {
      throw new Error('Data é obrigatória.');
    }

    if (!payload.tipo) {
      throw new Error('Tipo é obrigatório.');
    }

    if (API_CONFIG.useMock) {
      const novo: OcorrenciaFrequencia = {
        id: Math.random().toString(36).substring(2, 11),
        servidorId: payload.servidor_id || '',
        data: payload.data,
        tipo: payload.tipo,
        turno: payload.turno,
        descricao: payload.descricao,
      };

      frequenciaMock.push(novo);
      return novo;
    }

    try {
      const response = await fetchJson<ApiItemResponse<any>>('/api/frequencia', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const normalized = mapFromDB(unwrapItemResponse(response));
      await registrarLog('CRIAR', normalized.id, dados as any);
      return normalized;
    } catch (error) {
      console.warn('[frequenciaService] Falha ao criar via API, tentando Supabase...', error);

      const { data, error: sbError } = await supabase
        .from('frequencia')
        .insert(payload)
        .select()
        .single();

      if (sbError) throw sbError;

      const normalized = mapFromDB(data);
      await registrarLog('CRIAR', normalized.id, dados as any);
      return normalized;
    }
  },

  registrarOcorrencia: async (dados: RegistrarOcorrenciaInput): Promise<OcorrenciaFrequencia> => {
    return apiFrequencia.adicionar({
      servidorId: dados.servidorId || '',
      data: dados.data,
      tipo: dados.tipo,
      turno: dados.turno || 'INTEGRAL',
      descricao: dados.descricao || '',
    } as Omit<OcorrenciaFrequencia, 'id'>);
  },

  editar: async (id: string, dados: Partial<OcorrenciaFrequencia>): Promise<OcorrenciaFrequencia> => {
    if (!id) {
      throw new Error('ID da ocorrência é obrigatório.');
    }

    const payload = mapToDB(dados);

    if (API_CONFIG.useMock) {
      const index = frequenciaMock.findIndex((f) => f.id === id);
      if (index === -1) throw new Error('Ocorrência não encontrada');

      frequenciaMock[index] = {
        ...frequenciaMock[index],
        ...dados,
        data: dados.data ? normalizeDate(dados.data) : frequenciaMock[index].data,
      };

      return mapFromDB(frequenciaMock[index]);
    }

    try {
      const response = await fetchJson<ApiItemResponse<any>>(`/api/frequencia/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const normalized = mapFromDB(unwrapItemResponse(response));
      await registrarLog('EDITAR', id, dados as any);
      return normalized;
    } catch (error) {
      console.warn('[frequenciaService] Falha ao editar via API, tentando Supabase...', error);

      const { data, error: sbError } = await supabase
        .from('frequencia')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (sbError) throw sbError;

      const normalized = mapFromDB(data);
      await registrarLog('EDITAR', id, dados as any);
      return normalized;
    }
  },

  excluir: async (id: string): Promise<void> => {
    if (!id) {
      throw new Error('ID da ocorrência é obrigatório.');
    }

    if (API_CONFIG.useMock) {
      frequenciaMock = frequenciaMock.filter((f) => f.id !== id);
      return;
    }

    try {
      await fetchJson(`/api/frequencia/${id}`, {
        method: 'DELETE',
      });
      await registrarLog('EXCLUIR', id, {});
      return;
    } catch (error) {
      console.warn('[frequenciaService] Falha ao excluir via API, tentando Supabase...', error);

      const { error: sbError } = await supabase
        .from('frequencia')
        .delete()
        .eq('id', id);

      if (sbError) throw sbError;

      await registrarLog('EXCLUIR', id, {});
    }
  },

  exportarDocx: async (params: ExportarFrequenciaInput): Promise<void> => {
    await tentarExportarViaApi('docx', params);
    await registrarLog('EXPORTAR', params.servidorId, {
      formato: 'DOCX',
      mes: params.mes,
      ano: params.ano,
      incluirPonto: !!params.incluirPonto,
    });
  },

  exportarPdf: async (params: ExportarFrequenciaInput): Promise<void> => {
    await tentarExportarViaApi('pdf', params);
    await registrarLog('EXPORTAR', params.servidorId, {
      formato: 'PDF',
      mes: params.mes,
      ano: params.ano,
      incluirPonto: !!params.incluirPonto,
    });
  },

  exportarCsv: async (params: ExportarFrequenciaInput): Promise<void> => {
    await tentarExportarViaApi('csv', params);
    await registrarLog('EXPORTAR', params.servidorId, {
      formato: 'CSV',
      mes: params.mes,
      ano: params.ano,
      incluirPonto: !!params.incluirPonto,
    });
  },
};

export const frequenciaService = apiFrequencia;
