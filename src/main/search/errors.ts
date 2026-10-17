/**
 * Search-engine error model.
 *
 * Adapters use this internal error class regardless of engine. Services
 * must use `toPublicSearchError()` at the IPC boundary: adapter messages
 * and details may contain server responses or connection credentials.
 *
 * Engine-specific quirks (e.g. ES 6.x mapping-type errors vs Solr
 * schema-mismatch errors) stay inside the adapter's branch — only the
 * normalized code is exposed here.
 */

import type { SearchEngineType } from '../../shared/searchEngine'

/** Stable error codes the renderer / service layer can switch on.
 *  Adapter-specific codes (e.g. ES `mapper_parsing_exception`) belong
 *  in `details`, not here. */
export type SearchEngineErrorCode =
  | 'unsupported_capability'
  | 'http_error'
  | 'network_error'
  | 'timeout'
  | 'parse_error'
  | 'auth_failed'

/** Serializable shape of `SearchEngineError`. The public IPC layer uses
 *  the redacted `PublicSearchError` shape below. */
export interface SearchEngineErrorShape {
  engineType: SearchEngineType
  status?: number
  code?: SearchEngineErrorCode
  message: string
  details?: unknown
}

export class SearchEngineError extends Error {
  readonly engineType: SearchEngineType
  readonly status?: number
  readonly code?: SearchEngineErrorCode
  readonly details?: unknown

  constructor(shape: SearchEngineErrorShape) {
    super(shape.message)
    this.name = 'SearchEngineError'
    this.engineType = shape.engineType
    this.status = shape.status
    this.code = shape.code
    this.details = shape.details
  }

  /** Internal diagnostic shape. Never return this directly over IPC. */
  toJSON(): SearchEngineErrorShape {
    return {
      engineType: this.engineType,
      status: this.status,
      code: this.code,
      message: this.message,
      details: this.details
    }
  }
}

/** Convenience: pick the right code from a HTTP status. */
export function codeFromHttpStatus(status: number): SearchEngineErrorCode {
  if (status === 401 || status === 403) return 'auth_failed'
  if (status === 408 || status === 504) return 'timeout'
  return 'http_error'
}

export interface PublicSearchError {
  code: string
  operation: string
  message: string
}

const PUBLIC_ERROR_MESSAGES: Record<string, string> = {
  cancelled: '请求已取消',
  invalid_request: '请求参数无效，请检查输入',
  auth_failed: '认证失败，请检查用户名和密码',
  timeout: '请求超时，请稍后重试',
  network_error: '无法连接搜索引擎，请检查地址和网络',
  unsupported_capability: '当前引擎或服务器版本不支持此操作',
  parse_error: '请求或服务器响应格式无效，请检查查询与字段格式',
  resource_not_found: '请求的资源或文档不存在，请刷新后重试',
  connection_not_found: '未找到连接，请重新选择连接',
  conflict: '数据版本冲突，请刷新后重试',
  payload_too_large: '请求数据过大，请减小批次或文档大小',
  rate_limited: '服务器请求过于频繁，请稍后重试',
  http_error: '服务器请求失败，请检查请求和服务器状态',
  operation_failed: '操作失败，请检查请求和服务器状态后重试'
}

/** Only fixed messages and validated numeric statuses can cross IPC.
 * Never include Error.message, details, stack, request URL or headers. */
export function toPublicSearchError(error: unknown, operation: string): PublicSearchError {
  let code = 'operation_failed'
  if (error instanceof Error && error.name === 'AbortError') {
    code = 'cancelled'
  } else if (error instanceof Error && error.name === 'ConnectionNotFoundError') {
    code = 'connection_not_found'
  } else if (error instanceof TypeError) {
    code = 'invalid_request'
  } else if (error instanceof SearchEngineError) {
    code = error.code && Object.prototype.hasOwnProperty.call(PUBLIC_ERROR_MESSAGES, error.code)
      ? error.code
      : 'http_error'
    if (code === 'http_error') {
      switch (error.status) {
        case 400: case 422: code = 'invalid_request'; break
        case 401: case 403: code = 'auth_failed'; break
        case 404: code = 'resource_not_found'; break
        case 408: case 504: code = 'timeout'; break
        case 409: code = 'conflict'; break
        case 413: code = 'payload_too_large'; break
        case 429: code = 'rate_limited'; break
      }
    }
  }
  const status = error instanceof SearchEngineError && Number.isInteger(error.status)
    && error.status! >= 100 && error.status! <= 599 ? error.status : undefined
  return {
    code,
    operation,
    message: code === 'http_error' && status
      ? `服务器请求失败（HTTP ${status}），请检查请求和服务器状态`
      : PUBLIC_ERROR_MESSAGES[code]
  }
}
