import { searchHttpRequest } from '../../search/httpClient'
import type { HttpMethod } from '../../search/httpClient'
import type { SearchConnection } from '../../../shared/searchEngine'

export interface SolrRequestOptions {
  method: HttpMethod
  path: string
  query?: Record<string, string | number | boolean | string[] | undefined>
  body?: unknown
  signal?: AbortSignal
}

/** A bare host defaults to /solr. Explicit proxy prefixes are preserved. */
export function buildSolrUrl(connectionUrl: string, options: Pick<SolrRequestOptions, 'path' | 'query'>): string {
  const url = new URL(connectionUrl)
  const basePath = url.pathname.replace(/\/+$/, '') || '/solr'
  url.pathname = basePath + (options.path.startsWith('/') ? options.path : '/' + options.path)
  url.search = ''
  url.hash = ''
  for (const [key, value] of Object.entries({...options.query, wt: 'json'})) {
    if (value === undefined) continue
    for (const part of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, String(part))
    }
  }
  return url.toString()
}

export async function solrRequest<T = unknown>(connection: SearchConnection, options: SolrRequestOptions): Promise<T> {
  const headers: Record<string, string> = {}
  if (connection.authType === 'basic' && connection.username) {
    headers.Authorization = `Basic ${Buffer.from(`${connection.username}:${connection.password ?? ''}`, 'utf8').toString('base64')}`
  }
  return searchHttpRequest<T>({engineType: 'solr', method: options.method,
    url: buildSolrUrl(connection.url, options), headers, body: options.body, signal: options.signal})
}
