/**
 * Export — V0.3.0 §9.5.
 *
 *  The service layer does file IO + format serialization (JSON /
 *  NDJSON / CSV). This file issues the `_search` and returns the
 *  hits in engine-native shape. The split keeps the adapter free of
 *  any filesystem dependency.
 */

import { elasticsearchRequest } from './client'
import { SearchEngineError } from '../../search/errors'
import { createCancelledError } from '../../services/jobCancel.service'
import { runWithRequestContext } from '../../search/requestContext'
import type { SearchConnection } from '../../../shared/searchEngine'
import type {
  ExportInput,
  ExportResult
} from '../../search/adapter.types'
import type { DocumentHit } from '../../../shared/ipc'

interface EsSearchResponse {
  _scroll_id?: string
  timed_out?: boolean
  _shards?: { failed?: number }
  hits?: {
    total?: number | { value?: number }
    hits?: Array<{
      _index?: string
      _id?: string
      _score?: number | null
      _source?: Record<string, unknown> | null
    }>
  }
}

function ensureCompletePage(connection: SearchConnection, response: EsSearchResponse): void {
  if (!response || !Array.isArray(response.hits?.hits)) {
    throw new SearchEngineError({engineType: connection.engineType, code: 'parse_error', message: '导出查询响应格式无效。'})
  }
  if (response.timed_out || (response._shards?.failed ?? 0) > 0) {
    throw new SearchEngineError({engineType: connection.engineType, code: 'http_error', message: '导出查询返回部分结果，已停止以避免静默遗漏。'})
  }
}

function throwIfCancelled(input: ExportInput): void {
  if (input.signal?.aborted || input.isCancelled?.()) {
    throw createCancelledError()
  }
}

export async function exportDocuments(
  connection: SearchConnection,
  input: ExportInput
): Promise<ExportResult> {
  const body: Record<string, unknown> = {
    // track_total_hits so the caller can show "exported N of M" in a
    // follow-up UI; the renderer currently only renders `hits.length`.
    track_total_hits: true,
    size: input.maxRows,
    // Default to match_all if no DSL body was supplied.
    query: input.query ?? { match_all: {} }
  }
  throwIfCancelled(input)
  const response = await elasticsearchRequest<EsSearchResponse>(connection, {
    method: 'POST',
    path: `/${input.index}/_search`,
    body,
    signal: input.signal
  })
  throwIfCancelled(input)
  ensureCompletePage(connection, response)
  const rawHits = Array.isArray(response.hits?.hits)
    ? response.hits!.hits!
    : []
  throwIfCancelled(input)
  const hits: DocumentHit[] = rawHits.map((h) => ({
    id: h._id,
    fields: h._source ?? {},
    raw: h
  }))
  throwIfCancelled(input)
  let total = 0
  const t = response.hits?.total
  if (typeof t === 'number') {
    total = t
  } else if (t && typeof t === 'object' && typeof t.value === 'number') {
    total = t.value
  }
  return {
    index: input.index,
    hits,
    total
  }
}

export async function* exportBatches(
  connection: SearchConnection,
  input: ExportInput
): AsyncGenerator<DocumentHit[]> {
  let scrollId: string | undefined
  let remaining = input.maxRows
  try {
    throwIfCancelled(input)
    let response = await elasticsearchRequest<EsSearchResponse>(connection, {
      method: 'POST', path: `/${encodeURIComponent(input.index)}/_search`,
      query: { scroll: '1m' },
      body: { size: Math.min(1000, remaining), sort: ['_doc'], query: input.query ?? { match_all: {} } },
      signal: input.signal
    })
    while (true) {
      scrollId = response._scroll_id ?? scrollId
      throwIfCancelled(input)
      ensureCompletePage(connection, response)
      const raw = response.hits?.hits ?? []
      if (raw.length === 0) break
      const hits = raw.slice(0, remaining).map((hit): DocumentHit => ({
        id: hit._id, fields: hit._source ?? {}, raw: hit
      }))
      remaining -= hits.length
      yield hits
      throwIfCancelled(input)
      if (remaining <= 0 || !scrollId) break
      response = await elasticsearchRequest<EsSearchResponse>(connection, {
        method: 'POST', path: '/_search/scroll',
        body: { scroll: '1m', scroll_id: scrollId }, signal: input.signal
      })
    }
  } finally {
    if (scrollId) {
      // Release server resources even when the caller aborted its request chain.
      await runWithRequestContext({}, () => elasticsearchRequest(connection, {
        method: 'DELETE', path: '/_search/scroll', body: { scroll_id: [scrollId] }, timeoutMs: 5000
      })).catch(() => undefined)
    }
  }
}
