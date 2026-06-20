/**
 * Document search / CRUD.
 *
 *  All four methods use the typeless document API
 *  (`POST /{index}/_doc`, `PUT /{index}/_doc/{id}`,
 *   `DELETE /{index}/_doc/{id}`, `POST /{index}/_search`) which ES
 *  accepts in 6.x, 7.x, 8.x, and 9.x. The typed form
 *  (`/{index}/{type}/_doc/{id}`) is intentionally avoided so the
 *  adapter does not need a `requiresDocTypeForMapping` branch.
 */

import { elasticsearchRequest } from './client'
import { SearchEngineError } from '../../search/errors'
import type { SearchConnection } from '../../../shared/searchEngine'
import type {
  DocumentCreateInput,
  DocumentDeleteInput,
  DocumentDeleteResult,
  DocumentHit,
  DocumentSearchInput,
  DocumentSearchResult,
  DocumentUpdateInput,
  DocumentWriteResult
} from '../../search/adapter.types'

interface EsSearchResponse {
  took?: number
  timed_out?: boolean
  hits?: {
    total?: number | { value?: number; relation?: 'eq' | 'gte' }
    hits?: Array<{
      _index?: string
      _id?: string
      _score?: number | null
      _source?: Record<string, unknown> | null
    }>
  }
}

interface EsIndexResponse {
  _index?: string
  _id?: string
  _version?: number
  result?: string
}

function readTotal(
  total: unknown
): { value: number; relation: 'eq' | 'gte' } {
  if (typeof total === 'number') {
    return { value: total, relation: 'eq' }
  }
  if (total && typeof total === 'object') {
    const obj = total as { value?: number; relation?: 'eq' | 'gte' }
    return {
      value: typeof obj.value === 'number' ? obj.value : 0,
      relation: obj.relation === 'gte' ? 'gte' : 'eq'
    }
  }
  return { value: 0, relation: 'eq' }
}

function hitFromRaw(
  h: NonNullable<
    NonNullable<EsSearchResponse['hits']>['hits']
  >[number],
  fallbackIndex: string
): DocumentHit {
  return {
    _id: h._id ?? '',
    _index: h._index ?? fallbackIndex,
    _score: typeof h._score === 'number' ? h._score : null,
    _source: (h._source ?? null) as Record<string, unknown> | null
  }
}

export async function searchDocuments(
  connection: SearchConnection,
  input: DocumentSearchInput
): Promise<DocumentSearchResult> {
  const response = await elasticsearchRequest<EsSearchResponse>(connection, {
    method: 'POST',
    path: `/${input.index}/_search`,
    body: input.query
  })
  const took = typeof response.took === 'number' ? response.took : 0
  const totalInfo = readTotal(response.hits?.total)
  const rawHits = Array.isArray(response.hits?.hits)
    ? response.hits!.hits!
    : []
  const hits = rawHits.map((h) => hitFromRaw(h, input.index))
  return {
    connectionId: connection.id,
    index: input.index,
    took,
    total: totalInfo.value,
    totalRelation: totalInfo.relation,
    hits,
    raw: response
  }
}

export async function createDocument(
  connection: SearchConnection,
  input: DocumentCreateInput
): Promise<DocumentWriteResult> {
  const path = input.id
    ? `/${input.index}/_doc/${encodeURIComponent(input.id)}`
    : `/${input.index}/_doc`
  const response = await elasticsearchRequest<EsIndexResponse>(connection, {
    method: input.id ? 'PUT' : 'POST',
    path,
    body: input.source
  })
  return {
    connectionId: connection.id,
    index: input.index,
    id: response._id ?? input.id ?? '',
    result: response.result === 'updated' ? 'updated' : 'created',
    version: typeof response._version === 'number' ? response._version : 0
  }
}

export async function updateDocument(
  connection: SearchConnection,
  input: DocumentUpdateInput
): Promise<DocumentWriteResult> {
  const response = await elasticsearchRequest<EsIndexResponse>(connection, {
    method: 'PUT',
    path: `/${input.index}/_doc/${encodeURIComponent(input.id)}`,
    body: input.source
  })
  return {
    connectionId: connection.id,
    index: input.index,
    id: response._id ?? input.id,
    result: response.result === 'updated' ? 'updated' : 'created',
    version: typeof response._version === 'number' ? response._version : 0
  }
}

export async function deleteDocument(
  connection: SearchConnection,
  input: DocumentDeleteInput
): Promise<DocumentDeleteResult> {
  try {
    const response = await elasticsearchRequest<EsIndexResponse>(connection, {
      method: 'DELETE',
      path: `/${input.index}/_doc/${encodeURIComponent(input.id)}`
    })
    return {
      connectionId: connection.id,
      index: input.index,
      id: response._id ?? input.id,
      result: response.result === 'deleted' ? 'deleted' : 'not_found',
      version: typeof response._version === 'number' ? response._version : 0
    }
  } catch (err) {
    // ES returns 404 when the document doesn't exist. Treat that as a
    // soft "not_found" success so the renderer can refresh + move on.
    if (err instanceof SearchEngineError && err.status === 404) {
      return {
        connectionId: connection.id,
        index: input.index,
        id: input.id,
        result: 'not_found',
        version: 0
      }
    }
    throw err
  }
}