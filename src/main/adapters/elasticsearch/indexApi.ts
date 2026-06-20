/**
 * Index list / mapping / settings / create / delete.
 *
 *  Five thin wrappers over `GET /_cat/indices`,
 *  `GET /{index}/_mapping`, `GET /{index}/_settings`,
 *  `PUT /{index}`, and `DELETE /{index}`. ES 6.x mapping-type
 *  compatibility for `createIndex` is delegated to
 *  `versionCompat.ts` — the only file in the adapter that is allowed
 *  to look at `info.major`.
 */

import { elasticsearchRequest } from './client'
import { detect } from './detector'
import { normalizeCreateIndexBodyForEsVersion } from './versionCompat'
import {
  getCachedServerInfo,
  setCachedServerInfo
} from '../../search/serverVersionCache'
import type {
  SearchConnection,
  SearchIndexInfo
} from '../../../shared/searchEngine'
import type {
  CreateIndexInput,
  CreateIndexResult,
  DeleteIndexResult
} from '../../search/adapter.types'

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
}

function toInt(v: string | undefined, fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

function catRowToIndexInfo(row: CatIndexRow): SearchIndexInfo | null {
  if (!row.index) return null
  return {
    name: row.index,
    health: row.health,
    status: row.status,
    docsCount: toInt(row['docs.count']),
    storeSize: row['store.size'],
    pri: toInt(row.pri),
    rep: toInt(row.rep)
  }
}

export async function listIndices(
  connection: SearchConnection
): Promise<SearchIndexInfo[]> {
  const rows = await elasticsearchRequest<CatIndexRow[]>(connection, {
    method: 'GET',
    path: '/_cat/indices',
    query: { format: 'json', bytes: 'b' }
  })
  const indices = (Array.isArray(rows) ? rows : [])
    .map(catRowToIndexInfo)
    .filter((x): x is SearchIndexInfo => x !== null)
  indices.sort((a, b) => a.name.localeCompare(b.name))
  return indices
}

/** Raw mapping JSON. The service layer (Step 4) wraps with
 *  `connectionId` + `index` to produce `IndexMappingResult`. */
export async function getIndexMapping(
  connection: SearchConnection,
  indexName: string
): Promise<unknown> {
  return elasticsearchRequest<Record<string, unknown>>(connection, {
    method: 'GET',
    path: `/${indexName}/_mapping`
  })
}

/** Raw settings JSON. Service wraps. */
export async function getIndexSettings(
  connection: SearchConnection,
  indexName: string
): Promise<unknown> {
  return elasticsearchRequest<Record<string, unknown>>(connection, {
    method: 'GET',
    path: `/${indexName}/_settings`
  })
}

export async function createIndex(
  connection: SearchConnection,
  input: CreateIndexInput
): Promise<CreateIndexResult> {
  // We need `info.major` to drive `normalizeCreateIndexBodyForEsVersion`.
  // Use the version cache to avoid re-detecting on every create.
  let info = getCachedServerInfo(connection.id)
  if (!info) {
    info = await detect(connection)
    setCachedServerInfo(connection.id, info)
  }

  const body: {
    settings?: Record<string, unknown>
    mappings?: Record<string, unknown>
  } = {}
  if (input.settings && Object.keys(input.settings).length > 0) {
    body.settings = input.settings
  }
  if (input.mappings && Object.keys(input.mappings).length > 0) {
    body.mappings = input.mappings
  }
  const normalized = normalizeCreateIndexBodyForEsVersion(body, info)

  await elasticsearchRequest(connection, {
    method: 'PUT',
    path: `/${input.index}`,
    body: normalized
  })

  return {
    connectionId: connection.id,
    index: input.index,
    acknowledged: true
  }
}

export async function deleteIndex(
  connection: SearchConnection,
  indexName: string
): Promise<DeleteIndexResult> {
  await elasticsearchRequest(connection, {
    method: 'DELETE',
    path: `/${indexName}`
  })
  return {
    connectionId: connection.id,
    index: indexName,
    acknowledged: true
  }
}