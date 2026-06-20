/**
 * Elasticsearch-specific HTTP wrapper.
 *
 * V0.3.0 §8.2: thin layer over `searchHttpRequest` that knows about
 *  ES URL shape, Basic Auth, and the JSON / NDJSON Content-Type pair.
 *  Every other adapter method funnels through here so header / auth /
 *  URL logic lives in exactly one place.
 *
 *  We deliberately do NOT emit vendored Content-Types like
 *  `application/vnd.elasticsearch+json; compatible-with=8`. Those
 *  trip up older ES clusters and any reverse proxy that strips them
 *  (the whole reason the previous SDK-based path needed the
 *  `x-elastic-product` workaround).
 */

import { searchHttpRequest } from '../../search/httpClient'
import type {
  HttpMethod,
  HttpResponseType
} from '../../search/httpClient'
import type { SearchConnection } from '../../../shared/searchEngine'

export interface ElasticsearchRequestOptions {
  method: HttpMethod
  path: string
  query?: Record<string, string | number | boolean>
  body?: unknown
  /** Pre-serialized NDJSON body (e.g. for `POST /_bulk`). Mutually
   *  exclusive with `body`. */
  ndjsonBody?: string
  responseType?: HttpResponseType
  timeoutMs?: number
}

function buildAuthHeader(conn: SearchConnection): Record<string, string> {
  if (conn.authType !== 'basic' || !conn.username) return {}
  const raw = `${conn.username}:${conn.password ?? ''}`
  return {
    Authorization: `Basic ${Buffer.from(raw, 'utf-8').toString('base64')}`
  }
}

function buildUrl(
  conn: SearchConnection,
  path: string,
  query?: Record<string, string | number | boolean>
): string {
  const base = conn.url.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  if (!query) return `${base}${p}`
  const qs = Object.entries(query)
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
    )
    .join('&')
  return qs ? `${base}${p}?${qs}` : `${base}${p}`
}

export async function elasticsearchRequest<T = unknown>(
  connection: SearchConnection,
  options: ElasticsearchRequestOptions
): Promise<T> {
  const url = buildUrl(connection, options.path, options.query)
  const headers = buildAuthHeader(connection)
  return searchHttpRequest<T>({
    engineType: 'elasticsearch',
    method: options.method,
    url,
    headers,
    body: options.body,
    rawBody: options.ndjsonBody,
    responseType: options.responseType,
    timeoutMs: options.timeoutMs
  })
}