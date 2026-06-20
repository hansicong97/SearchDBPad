/**
 * Export — V0.3.0 §9.5.
 *
 *  The service layer does file IO + format serialization (JSON /
 *  NDJSON / CSV). This file issues the `_search` and returns the
 *  hits in engine-native shape. The split keeps the adapter free of
 *  any filesystem dependency.
 */

import { elasticsearchRequest } from './client'
import type { SearchConnection } from '../../../shared/searchEngine'
import type {
  ExportInput,
  ExportResult
} from '../../search/adapter.types'
import type { DocumentHit } from '../../../shared/ipc'

interface EsSearchResponse {
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
  const response = await elasticsearchRequest<EsSearchResponse>(connection, {
    method: 'POST',
    path: `/${input.index}/_search`,
    body
  })
  const rawHits = Array.isArray(response.hits?.hits)
    ? response.hits!.hits!
    : []
  const hits: DocumentHit[] = rawHits.map((h) => ({
    _id: h._id ?? '',
    _index: h._index ?? input.index,
    _score: typeof h._score === 'number' ? h._score : null,
    _source: (h._source ?? null) as Record<string, unknown> | null
  }))
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