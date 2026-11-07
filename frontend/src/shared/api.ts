import type { ApiErrorPayload } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string;
  readonly code?: string;

  constructor(message: string, status: number, requestId: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function bodyFieldNames(body: BodyInit | null | undefined): string[] | undefined {
  if (typeof body !== 'string') return undefined;
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as object).sort() : undefined;
  } catch {
    return undefined;
  }
}

function writeApiLog(event: string, fields: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info') {
  const logger = console[level];
  logger('[api]', { timestamp: new Date().toISOString(), source: 'frontend', event, ...fields });
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const requestId = createRequestId();
  const method = (init?.method || 'GET').toUpperCase();
  const startedAt = performance.now();
  const common = { request_id: requestId, method, url: path };
  writeApiLog('request_started', { ...common, body_fields: bodyFieldNames(init?.body) });

  try {
    const headers = new Headers(init?.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    headers.set('X-Request-ID', requestId);
    const response = await fetch(path, {
      ...init,
      headers,
    });
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const responseText = await response.text();
    let data: unknown = {};
    if (responseText) {
      try { data = JSON.parse(responseText); } catch {
        data = {};
        writeApiLog('response_parse_error', { ...common, status: response.status, content_type: response.headers.get('Content-Type') });
      }
    }
    if (!response.ok) {
      const payload = data as ApiErrorPayload;
      const detail = payload.detail;
      const message = typeof detail === 'string' ? detail : detail?.message || `Request failed (${response.status})`;
      const errorCode = typeof detail === 'object' && detail ? detail.code : undefined;
      writeApiLog('request_failed', { ...common, status: response.status, duration_ms: durationMs, error_code: errorCode, response_bytes: new TextEncoder().encode(responseText).length }, 'error');
      throw new ApiError(message, response.status, response.headers.get('X-Request-ID') || requestId, errorCode);
    }
    writeApiLog('request_completed', {
      ...common,
      status: response.status,
      duration_ms: durationMs,
      response_bytes: new TextEncoder().encode(responseText).length,
      content_type: response.headers.get('Content-Type'),
    });
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const message = error instanceof Error ? error.message : 'Network request failed';
    writeApiLog('request_network_error', { ...common, duration_ms: durationMs, error: message }, 'error');
    throw new ApiError(message, 0, requestId);
  }
}
