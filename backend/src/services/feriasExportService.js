import { API_BASE_URL } from '../config/api';

export type FeriasExportFormato = 'docx' | 'pdf';

export interface FeriasExportFiltros {
  ano: number;
  mes?: number | null;
  categoria?: string | null;
  setor?: string | null;
  status?: string | null;
  servidorCpf?: string | null;
  incluirInativos?: boolean;
  somenteEmFerias?: boolean;
}

export interface FeriasExportPayload {
  formato: FeriasExportFormato;
  filtros: FeriasExportFiltros;
}

export interface FeriasExportResult {
  ok: boolean;
  message?: string;
  fileName?: string;
  blob?: Blob;
}

const EXPORT_PATH = '/api/ferias/exportar';

function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

function buildExportUrl(): string {
  const base = normalizeBaseUrl(API_BASE_URL);

  if (!base) {
    throw new Error('API_BASE_URL não configurada.');
  }

  return `${base}${EXPORT_PATH}`;
}

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sanitizeFiltros(filtros: FeriasExportFiltros): FeriasExportFiltros {
  return {
    ano: Number(filtros.ano),
    mes: normalizeNumber(filtros.mes),
    categoria: normalizeString(filtros.categoria),
    setor: normalizeString(filtros.setor),
    status: normalizeString(filtros.status),
    servidorCpf: normalizeString(filtros.servidorCpf),
    incluirInativos: Boolean(filtros.incluirInativos),
    somenteEmFerias: Boolean(filtros.somenteEmFerias),
  };
}

function getFileNameFromDisposition(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) return undefined;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).replace(/["']/g, '').trim();
    } catch {
      return utf8Match[1].replace(/["']/g, '').trim();
    }
  }

  const asciiMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1].trim();
  }

  return undefined;
}

async function tryReadJson(response: Response): Promise<any | null> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function tryReadText(response: Response): Promise<string | null> {
  try {
    const text = await response.clone().text();
    return text?.trim() || null;
  } catch {
    return null;
  }
}

function isHtmlError(text: string | null): boolean {
  if (!text) return false;
  const lowered = text.toLowerCase();
  return lowered.includes('<!doctype html') || lowered.includes('<html');
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 1500);
}

class FeriasExportService {
  async exportar(payload: FeriasExportPayload): Promise<FeriasExportResult> {
    const endpoint = buildExportUrl();

    if (!payload?.formato) {
      throw new Error('Formato de exportação não informado.');
    }

    if (!payload?.filtros?.ano) {
      throw new Error('Ano é obrigatório para exportação.');
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60000);

    try {
      const body: FeriasExportPayload = {
        formato: payload.formato,
        filtros: sanitizeFiltros(payload.filtros),
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/octet-stream,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json,text/plain,*/*',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const responseJson = await tryReadJson(response);
      const responseText = responseJson ? null : await tryReadText(response);

      if (!response.ok) {
        const backendMessage =
          responseJson?.message ||
          responseJson?.error ||
          responseJson?.details ||
          (isHtmlError(responseText)
            ? 'O backend respondeu com HTML em vez do arquivo. Verifique se a rota POST /api/ferias/exportar está registrada corretamente.'
            : responseText) ||
          `Falha ao exportar férias (HTTP ${response.status}).`;

        throw new Error(backendMessage);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const disposition = response.headers.get('content-disposition');

      if (contentType.includes('application/json')) {
        const json = responseJson ?? (await tryReadJson(response));

        if (json?.downloadUrl) {
          const fileResponse = await fetch(json.downloadUrl, { method: 'GET', signal: controller.signal });

          if (!fileResponse.ok) {
            throw new Error(json?.message || 'Não foi possível baixar o arquivo exportado.');
          }

          const fileBlob = await fileResponse.blob();
          const derivedName =
            json?.fileName ||
            getFileNameFromDisposition(fileResponse.headers.get('content-disposition')) ||
            `ferias_${body.filtros.ano}.${payload.formato}`;

          triggerBrowserDownload(fileBlob, derivedName);

          return {
            ok: true,
            message: json?.message || 'Arquivo exportado com sucesso.',
            fileName: derivedName,
            blob: fileBlob,
          };
        }

        if (json?.ok === false) {
          throw new Error(json?.message || 'A exportação foi rejeitada pelo backend.');
        }

        throw new Error(
          json?.message ||
            'O backend respondeu JSON, mas não enviou arquivo nem URL de download.'
        );
      }

      const blob = await response.blob();

      if (!blob || blob.size === 0) {
        throw new Error('O arquivo exportado veio vazio.');
      }

      const fileName =
        getFileNameFromDisposition(disposition) ||
        `ferias_${body.filtros.ano}${body.filtros.mes ? `_${String(body.filtros.mes).padStart(2, '0')}` : ''}.${payload.formato}`;

      triggerBrowserDownload(blob, fileName);

      return {
        ok: true,
        message: 'Arquivo exportado com sucesso.',
        fileName,
        blob,
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('A exportação demorou demais e foi cancelada. Tente novamente.');
      }

      throw new Error(error?.message || 'Erro inesperado ao exportar férias.');
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

export const feriasExportService = new FeriasExportService();
