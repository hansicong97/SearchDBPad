/**
 * Index list business logic.
 *
 * Runs in the Electron main process. Uses the @elastic/elasticsearch
 * official client and the `_cat/indices` endpoint.
 *
 * Phase 3 scope: list all indices visible to the connection, normalized
 * to a stable shape with numeric fields (the cat API returns everything
 * as strings when format=json).
 *
 * Phase 4 scope: per-index `_mapping` and `_settings` lookups. The raw
 * JSON payload from Elasticsearch is returned unchanged — the renderer is
 * responsible for formatting and display.
 */

import { buildEsClient, resolveConnection } from './esClient'
import type {
  ApiResponse,
  EsIndexInfo,
  IndexListResult,
  IndexMappingResult,
  IndexSettingsResult
} from '../../shared/ipc'

interface CatIndexRow {
  health?: string
  status?: string
  index?: string
  uuid?: string
  pri?: string
  rep?: string
  'docs.count'?: string
  'docs.deleted'?: string
  'store.size'?: string
  'pri.store.size'?: string
}

function toInt(v: string | undefined, fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

function toIndexInfo(row: CatIndexRow): EsIndexInfo | null {
  if (!row.index) return null
  return {
    index: row.index,
    health: (row.health ?? 'unknown') as EsIndexInfo['health'],
    status: (row.status ?? 'unknown') as EsIndexInfo['status'],
    docsCount: toInt(row['docs.count']),
    docsDeleted: toInt(row['docs.deleted']),
    storeSize: toInt(row['store.size']),
    pri: toInt(row.pri),
    rep: toInt(row.rep),
    uuid: row.uuid
  }
}

export async function listIndices(
  connectionId: string
): Promise<ApiResponse<IndexListResult>> {
  try {
    const conn = resolveConnection(connectionId)
    const client = buildEsClient(conn)
    const rows = (await client.cat.indices({
      format: 'json',
      bytes: 'b'
    })) as unknown as CatIndexRow[]
    const indices = (Array.isArray(rows) ? rows : [])
      .map(toIndexInfo)
      .filter((x): x is EsIndexInfo => x !== null)
    // Newest-first by name is a stable, cheap default ordering.
    indices.sort((a, b) => a.index.localeCompare(b.index))
    return {
      success: true,
      data: {
        connectionId,
        indices,
        indexCount: indices.length
      }
    }
  } catch (err) {
    return {
      success: false,
      error: {
        message: err instanceof Error ? err.message : String(err)
      }
    }
  }
}

/* ------------------- Phase 4: per-index mapping / settings ------------------- */

/**
 * Surface a short, user-friendly message for a not-found index and fall back
 * to the raw error message for anything else. The @elastic/elasticsearch
 * client throws `ResponseError` (with `meta.statusCode`) on 4xx/5xx.
 */
function describeIndexError(err: unknown, index: string): string {
  if (err && typeof err === 'object' && 'meta' in err) {
    const meta = (err as { meta?: { statusCode?: number } }).meta
    if (meta?.statusCode === 404) {
      return `索引 "${index}" 不存在`
    }
    if (meta?.statusCode === 400) {
      return `索引名无效: ${index}`
    }
  }
  return err instanceof Error ? err.message : String(err)
}

export async function getIndexMapping(
  connectionId: string,
  index: string
): Promise<ApiResponse<IndexMappingResult>> {
  try {
    const conn = resolveConnection(connectionId)
    const client = buildEsClient(conn)
    const payload = (await client.indices.getMapping({
      index
    })) as unknown as Record<string, unknown>
    return {
      success: true,
      data: { connectionId, index, mapping: payload }
    }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, index) }
    }
  }
}

export async function getIndexSettings(
  connectionId: string,
  index: string
): Promise<ApiResponse<IndexSettingsResult>> {
  try {
    const conn = resolveConnection(connectionId)
    const client = buildEsClient(conn)
    const payload = (await client.indices.getSettings({
      index
    })) as unknown as Record<string, unknown>
    return {
      success: true,
      data: { connectionId, index, settings: payload }
    }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, index) }
    }
  }
}
