/**
 * Document search + CRUD business logic.
 *
 * Runs in the Electron main process — the only place allowed to talk to
 * Elasticsearch. Uses the @elastic/elasticsearch official client.
 *
 * Phase 5 scope: `searchDocuments` forwards the caller's DSL body to
 * `POST /{index}/_search` and returns a normalized result shape.
 *
 * Phase 7 scope: `createDocument` / `updateDocument` / `deleteDocument`
 * expose the basic document maintenance surface. Both create and update
 * go through `client.index` (POST vs PUT based on `id`); delete uses
 * `client.delete`. Bulk import and export are intentionally NOT here.
 */

import { buildEsClient, resolveConnection } from './esClient'
import type {
  ApiResponse,
  DocumentDeleteRequest,
  DocumentDeleteResult,
  DocumentHit,
  DocumentSearchRequest,
  DocumentSearchResult,
  DocumentWriteRequest,
  DocumentWriteResult
} from '../../shared/ipc'

/** Shape of the subset of an ES `_search` response that we read. The full
 *  response is also returned as `raw` so the renderer can show it. */
interface EsSearchResponseShape {
  took?: number
  timed_out?: boolean
  hits?: {
    total?: number | { value?: number; relation?: 'eq' | 'gte' } | undefined
    hits?: Array<{
      _index?: string
      _id?: string
      _score?: number | null
      _source?: Record<string, unknown> | null
    }>
  }
}

/** Same friendly-error pattern used by `index.service.ts`. Keeps 404
 *  ("索引 ... 不存在") and 400 ("索引名无效") readable instead of leaking
 *  the raw ES `ResponseError`. */
function describeIndexError(err: unknown, index: string): string {
  if (err && typeof err === 'object' && 'meta' in err) {
    const meta = (err as { meta?: { statusCode?: number } }).meta
    if (meta?.statusCode === 404) {
      return `索引 "${index}" 不存在`
    }
    if (meta?.statusCode === 400) {
      return `DSL 无效或索引名非法: ${index}`
    }
  }
  return err instanceof Error ? err.message : String(err)
}

/** Normalize `hits.total` which can be either a number (legacy) or an
 *  object with `value` / `relation` (ES 7+). */
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

export async function searchDocuments(
  req: DocumentSearchRequest
): Promise<ApiResponse<DocumentSearchResult>> {
  const { connectionId, index, query } = req
  try {
    const conn = resolveConnection(connectionId)
    const client = buildEsClient(conn)
    // Forward the caller's DSL body. The v8 client's `search` method
    // accepts an arbitrary `index` + optional body fields, so spreading
    // `query` keeps `from`/`size`/`query`/`sort`/`aggs`/etc. intact.
    const response = (await client.search({
      index,
      ...query
    } as Parameters<typeof client.search>[0])) as unknown as EsSearchResponseShape

    const took = typeof response.took === 'number' ? response.took : 0
    const totalInfo = readTotal(response.hits?.total)
    const rawHits = Array.isArray(response.hits?.hits)
      ? response.hits!.hits!
      : []
    const hits: DocumentHit[] = rawHits.map((h) => ({
      _id: h._id ?? '',
      _index: h._index ?? index,
      _score: typeof h._score === 'number' ? h._score : null,
      _source: (h._source ?? null) as Record<string, unknown> | null
    }))

    return {
      success: true,
      data: {
        connectionId,
        index,
        took,
        total: totalInfo.value,
        totalRelation: totalInfo.relation,
        hits,
        raw: response
      }
    }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, index) }
    }
  }
}

/* ------------------- Phase 7: document CRUD ------------------- */

interface EsIndexResponseShape {
  _index?: string
  _id?: string
  _version?: number
  result?: string
}

interface EsDeleteResponseShape {
  _index?: string
  _id?: string
  _version?: number
  result?: string
}

function describeWriteError(err: unknown, index: string, id: string | null): string {
  if (err && typeof err === 'object' && 'meta' in err) {
    const meta = (err as { meta?: { statusCode?: number; body?: { error?: { type?: string } } } })
      .meta
    if (meta?.statusCode === 404) {
      return id
        ? `索引 "${index}" 不存在，无法对 _id="${id}" 进行操作`
        : `索引 "${index}" 不存在`
    }
    if (meta?.statusCode === 400) {
      const reason =
        (typeof meta.body?.error?.type === 'string' && meta.body.error.type) ||
        '请求格式错误'
      return `${reason}（${index}${id ? `/${id}` : ''}）`
    }
    if (meta?.statusCode === 409) {
      return `版本冲突：${index}/${id ?? ''}`
    }
  }
  return err instanceof Error ? err.message : String(err)
}

/** Create a document. If `id` is provided, PUT is used so the caller
 *  controls the `_id`; otherwise POST and ES auto-generates one. */
export async function createDocument(
  req: DocumentWriteRequest
): Promise<ApiResponse<DocumentWriteResult>> {
  const { connectionId, index, id, source } = req
  try {
    const conn = resolveConnection(connectionId)
    const client = buildEsClient(conn)
    const params: Record<string, unknown> = {
      index,
      document: source
    }
    if (id && id.trim() !== '') {
      params.id = id.trim()
    }
    const response = (await client.index(
      params as unknown as Parameters<typeof client.index>[0]
    )) as unknown as EsIndexResponseShape
    return {
      success: true,
      data: {
        connectionId,
        index,
        id: response._id ?? id ?? '',
        result: response.result === 'updated' ? 'updated' : 'created',
        version: typeof response._version === 'number' ? response._version : 0
      }
    }
  } catch (err) {
    return {
      success: false,
      error: { message: describeWriteError(err, index, id ?? null) }
    }
  }
}

/** Update (replace the full `_source`) of an existing document. */
export async function updateDocument(
  req: DocumentWriteRequest
): Promise<ApiResponse<DocumentWriteResult>> {
  const { connectionId, index, id, source } = req
  if (!id || id.trim() === '') {
    return {
      success: false,
      error: { message: '更新文档需要提供 _id' }
    }
  }
  try {
    const conn = resolveConnection(connectionId)
    const client = buildEsClient(conn)
    const response = (await client.index({
      index,
      id: id.trim(),
      document: source
    } as Parameters<typeof client.index>[0])) as unknown as EsIndexResponseShape
    return {
      success: true,
      data: {
        connectionId,
        index,
        id: response._id ?? id,
        result: 'updated',
        version: typeof response._version === 'number' ? response._version : 0
      }
    }
  } catch (err) {
    return {
      success: false,
      error: { message: describeWriteError(err, index, id) }
    }
  }
}

/** Delete a document by `_id`. A `not_found` from ES is reported as
 *  success with `result: 'not_found'` so the renderer can decide whether
 *  to surface that as an info toast (the row was already gone) vs. an
 *  error. */
export async function deleteDocument(
  req: DocumentDeleteRequest
): Promise<ApiResponse<DocumentDeleteResult>> {
  const { connectionId, index, id } = req
  try {
    const conn = resolveConnection(connectionId)
    const client = buildEsClient(conn)
    const response = (await client.delete({
      index,
      id
    } as Parameters<typeof client.delete>[0])) as unknown as EsDeleteResponseShape
    return {
      success: true,
      data: {
        connectionId,
        index,
        id: response._id ?? id,
        result: response.result === 'deleted' ? 'deleted' : 'not_found',
        version: typeof response._version === 'number' ? response._version : 0
      }
    }
  } catch (err) {
    // ES throws a 404 ResponseError when the document does not exist.
    // Surface that as a normal "not_found" rather than an error so the
    // renderer can refresh and move on.
    if (err && typeof err === 'object' && 'meta' in err) {
      const meta = (err as { meta?: { statusCode?: number } }).meta
      if (meta?.statusCode === 404) {
        return {
          success: true,
          data: {
            connectionId,
            index,
            id,
            result: 'not_found',
            version: 0
          }
        }
      }
    }
    return {
      success: false,
      error: { message: describeWriteError(err, index, id) }
    }
  }
}