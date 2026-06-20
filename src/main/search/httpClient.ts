/**
 * Generic HTTP client for search-engine adapters.
 *
 * V0.3.0 replaces `@elastic/elasticsearch`'s Transport with this thin
 * wrapper. The wrapper does four things and nothing else:
 *
 *  1. Builds the request (method, headers, JSON / NDJSON body).
 *  2. Applies a timeout via AbortController and chains an optional
 *     caller-provided AbortSignal.
 *  3. Translates non-2xx responses and network failures into a single
 *     `SearchEngineError` (see `./errors.ts`).
 *  4. Parses the response body as JSON (default), text, or none.
 *
 * Engine-specific headers, paths, body shapes, and error normalization
 * live in the adapter — not here.
 */

import type { SearchEngineType } from '../../shared/searchEngine'
import {
  SearchEngineError,
  codeFromHttpStatus
} from './errors'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD'
export type HttpResponseType = 'json' | 'text' | 'none'

export interface SearchHttpRequestOptions {
  /** Engine that owns this request — stamped onto thrown errors so
   *  callers can route diagnostics. */
  engineType: SearchEngineType
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  /** JSON-serializable body. Mutually exclusive with `rawBody`. */
  body?: unknown
  /** Pre-serialized raw body (e.g. NDJSON for the ES `_bulk` API).
   *  Mutually exclusive with `body`. */
  rawBody?: string
  /** Override Content-Type. Otherwise derived from body shape:
   *  - `body` set       → `application/json`
   *  - `rawBody` set    → `application/x-ndjson` */
  contentType?: string
  /** Override response parsing. Default: 'json'. Use 'none' for HEAD. */
  responseType?: HttpResponseType
  /** Request timeout in ms. Default: 30000. */
  timeoutMs?: number
  /** Optional caller-provided AbortSignal. */
  signal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 30_000

export async function searchHttpRequest<T = unknown>(
  options: SearchHttpRequestOptions
): Promise<T> {
  if (options.body !== undefined && options.rawBody !== undefined) {
    throw new TypeError(
      'searchHttpRequest: `body` and `rawBody` are mutually exclusive'
    )
  }

  // Headers — caller wins, but always inject Accept.
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain',
    ...(options.headers ?? {})
  }

  // Body + Content-Type.
  let body: string | undefined
  if (options.body !== undefined) {
    body = JSON.stringify(options.body)
    if (!hasContentType(headers)) {
      headers['Content-Type'] = options.contentType ?? 'application/json'
    }
  } else if (options.rawBody !== undefined) {
    body = options.rawBody
    if (!hasContentType(headers)) {
      headers['Content-Type'] = options.contentType ?? 'application/x-ndjson'
    }
  } else if (options.contentType) {
    headers['Content-Type'] = options.contentType
  }

  // Timeout + caller signal chained into one AbortController.
  const controller = new AbortController()
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort()
    } else {
      options.signal.addEventListener(
        'abort',
        () => controller.abort(),
        { once: true }
      )
    }
  }

  let response: Response
  try {
    response = await fetch(options.url, {
      method: options.method,
      headers,
      body,
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(timeoutHandle)
    const aborted =
      (err as { name?: string }).name === 'AbortError' ||
      controller.signal.aborted
    if (aborted) {
      throw new SearchEngineError({
        engineType: options.engineType,
        code: 'timeout',
        message: `请求超时: ${options.method} ${options.url}`,
        details: { url: options.url, method: options.method }
      })
    }
    throw new SearchEngineError({
      engineType: options.engineType,
      code: 'network_error',
      message: `网络错误: ${(err as Error).message}`,
      details: { url: options.url, method: options.method }
    })
  }
  clearTimeout(timeoutHandle)

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new SearchEngineError({
      engineType: options.engineType,
      status: response.status,
      code: codeFromHttpStatus(response.status),
      message: `HTTP ${response.status} ${response.statusText || ''}`.trim(),
      details: errBody.slice(0, 2000)
    })
  }

  const responseType = options.responseType ?? 'json'
  if (responseType === 'none') {
    return undefined as T
  }
  if (responseType === 'text') {
    return (await response.text()) as T
  }

  // JSON parsing with an empty-body shortcut and a typed parse error.
  const text = await response.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new SearchEngineError({
      engineType: options.engineType,
      code: 'parse_error',
      message: `响应解析失败: ${(err as Error).message}`,
      details: { url: options.url, body: text.slice(0, 500) }
    })
  }
}

function hasContentType(headers: Record<string, string>): boolean {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'content-type') return true
  }
  return false
}