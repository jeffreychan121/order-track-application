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

const PRIVATE_LOG_FIELD = /authorization|password|api[_-]?key|account[_-]?number|token|secret|customer|recipient|contact|email|phone|mobile|address|street|suburb|postcode|postal|company|name|description|input/i;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

/** 递归清除前后端日志中的客户资料和凭据，只为定位保留有限运单尾号。 */
function sanitizeApiLogValue(value: unknown, key = ''): unknown {
  if (/^(tracking_number|tracking_id|article_id|consignment_number)$/i.test(key)) {
    const trackingNumber = String(value ?? '');
    return trackingNumber.length > 4 ? `…${trackingNumber.slice(-4)}` : '[REDACTED]';
  }
  if (PRIVATE_LOG_FIELD.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) {
    const items = value.slice(0, 40).map(item => sanitizeApiLogValue(item));
    return value.length > 40 ? [...items, `[${value.length - 40} more items omitted]`] : items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([field, fieldValue]) => [field, sanitizeApiLogValue(fieldValue, field)]));
  }
  if (typeof value === 'string') {
    return value.replace(EMAIL_VALUE, '[REDACTED]').slice(0, 1000);
  }
  return value;
}

/** 只摘要小型 JSON 请求体；其他格式和超限正文不写入 Console。 */
function getRequestLogParams(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string' || !body) return undefined;
  if (body.length > 16 * 1024) return { omitted: 'payload_too_large', characters: body.length };
  try {
    return fitLogPayload(JSON.parse(body));
  } catch {
    return { omitted: 'invalid_json', characters: body.length };
  }
}

/** 脱敏后再限制日志体积，防止响应数组造成过多 Console 输出。 */
function fitLogPayload(value: unknown): unknown {
  const safeValue = sanitizeApiLogValue(value);
  const size = new TextEncoder().encode(JSON.stringify(safeValue)).length;
  return size > 16 * 1024 ? { omitted: 'payload_too_large_after_redaction', bytes: size } : safeValue;
}

/** 仅提取调用位置用于排错，避免异常首行把上游输入写进日志。 */
function errorStackFrames(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  // Error.message 可能包含上游返回值；只保留调用位置，不记录首行异常文本。
  return error.stack.split('\n').slice(1, 25).join('\n');
}

/** 为每次前端请求生成独立 ID，并由后端在响应中回传用于关联日志。 */
function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 仅记录请求 JSON 的字段名，不重复记录字段值或敏感内容。 */
function bodyFieldNames(body: BodyInit | null | undefined): string[] | undefined {
  if (typeof body !== 'string' || body.length > 16 * 1024) return undefined;
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as object).sort() : undefined;
  } catch {
    return undefined;
  }
}

/** 统一前端日志事件结构，方便按 request_id 对照后端 JSON 日志。 */
function writeApiLog(event: string, fields: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info') {
  const logger = console[level];
  logger('[api]', { timestamp: new Date().toISOString(), source: 'frontend', event, ...fields });
}

/** 将 FastAPI 字符串、对象和字段校验错误统一整理成用户可读文案。 */
function getApiErrorMessage(detail: ApiErrorPayload['detail'], status: number): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map(issue => {
      const field = issue.loc?.filter(part => part !== 'body').map(String).join('.');
      const message = issue.msg?.replace(/^Value error,\s*/i, '').trim();
      return [field, message].filter(Boolean).join(': ');
    }).filter(Boolean);
    return messages.join('; ') || `Request failed (${status})`;
  }
  return detail?.message || `Request failed (${status})`;
}

/** 统一发送 JSON API 请求、维护 Request ID，并记录脱敏后的生命周期日志。 */
export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const requestId = createRequestId();
  const method = (init?.method || 'GET').toUpperCase();
  const startedAt = performance.now();
  const common = { request_id: requestId, method, url: path, request_params: getRequestLogParams(init?.body) };
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
      const message = getApiErrorMessage(detail, response.status);
      const errorCode = typeof detail === 'object' && detail && !Array.isArray(detail) ? detail.code : undefined;
      const apiError = new ApiError(message, response.status, response.headers.get('X-Request-ID') || requestId, errorCode);
      writeApiLog('request_failed', {
        ...common,
        status: response.status,
        duration_ms: durationMs,
        error_code: errorCode,
        response_bytes: new TextEncoder().encode(responseText).length,
        response_params: fitLogPayload(data),
        error_stack: sanitizeApiLogValue(errorStackFrames(apiError), 'stack'),
      }, 'error');
      throw apiError;
    }
    writeApiLog('request_completed', {
      ...common,
      status: response.status,
      duration_ms: durationMs,
      response_bytes: new TextEncoder().encode(responseText).length,
      content_type: response.headers.get('Content-Type'),
      response_params: fitLogPayload(data),
    });
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const message = error instanceof Error ? error.message : 'Network request failed';
    writeApiLog('request_network_error', {
      ...common,
      duration_ms: durationMs,
      error_type: error instanceof Error ? error.name : 'Error',
      error_stack: sanitizeApiLogValue(errorStackFrames(error), 'stack'),
    }, 'error');
    throw new ApiError(message, 0, requestId);
  }
}
