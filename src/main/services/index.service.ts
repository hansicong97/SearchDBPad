/**
 * Index list / mapping / settings / create / delete.
 *
 * V0.3.0: routed through the adapter. The service still returns the
 *  legacy `EsIndexInfo` shape so the renderer (which sorts on
 *  `docsDeleted` and `storeSize`) keeps working unchanged.
 *
 * V0.3.1 C-2: the adapter now reports real `docsDeleted` and `uuid`
 *  values (see `SearchIndexInfo`), so this layer no longer overrides
 *  them with a `0` / `undefined` placeholder — whatever the adapter
 *  emits is forwarded to the renderer unchanged. Fields the adapter
 *  can't provide stay `undefined`, which the renderer's
 *  `formatNumber` / table render already handle. */

import { resolveAdapterByConnectionId } from './searchEngine.service'
import type {
  ApiResponse,
  EsIndexInfo,
  IndexCreateRequest,
  IndexCreateResult,
  IndexDeleteRequest,
  IndexDeleteResult,
  IndexLifecycleRequest,
  IndexLifecycleResult,
  IndexListResult,
  IndexMappingResult,
  IndexSettingsResult,
  IndexUpdateMappingRequest,
  IndexUpdateMappingResult,
  IndexUpdateSettingsRequest,
  IndexUpdateSettingsResult,
  ShardCancelRequest,
  ShardInfo,
  ShardListResult,
  ShardRelocateRequest,
  ShardRerouteResult
} from '../../shared/ipc'
import type { SearchIndexInfo } from '../../shared/searchEngine'
import type { CreateIndexInput } from '../search/adapter.types'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function toInt(v: string | undefined, fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

/** Map the adapter's engine-agnostic `SearchIndexInfo` to the
 *  renderer-facing `EsIndexInfo`. Numeric fields default to `0` when
 *  the adapter omits them so the table sorters never have to deal
 *  with `undefined`. V0.3.1 C-2: `docsDeleted` and `uuid` are passed
 *  through unchanged — engines that report them (Elasticsearch) give
 *  the renderer the real value, engines that don't just leave them
 *  `undefined`. */
function searchInfoToEsIndex(info: SearchIndexInfo): EsIndexInfo | null {
  if (!info.name) return null
  return {
    index: info.name,
    health: (info.health ?? 'unknown') as EsIndexInfo['health'],
    status: (info.status ?? 'unknown') as EsIndexInfo['status'],
    docsCount: info.docsCount ?? 0,
    docsDeleted: info.docsDeleted ?? 0,
    storeSize: toInt(info.storeSize),
    pri: info.pri ?? 0,
    rep: info.rep ?? 0,
    uuid: info.uuid
  }
}

/** Convert a thrown error into a short, user-friendly message that
 *  matches the wording the renderer was used to under the SDK path. */
function describeIndexError(err: unknown, index: string): string {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: number }).status
    if (status === 404) return `索引 "${index}" 不存在`
    if (status === 400) return `索引名无效: ${index}`
  }
  return errMsg(err)
}

export async function listIndices(
  connectionId: string
): Promise<ApiResponse<IndexListResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const indices = await adapter.listIndices(connection)
    const esIndices = indices
      .map(searchInfoToEsIndex)
      .filter((x): x is EsIndexInfo => x !== null)
    esIndices.sort((a, b) => a.index.localeCompare(b.index))
    return {
      success: true,
      data: {
        connectionId,
        indices: esIndices,
        indexCount: esIndices.length
      }
    }
  } catch (err) {
    return { success: false, error: { message: errMsg(err) } }
  }
}

export async function getIndexMapping(
  connectionId: string,
  index: string
): Promise<ApiResponse<IndexMappingResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const mapping = await adapter.getIndexMapping(connection, index)
    return {
      success: true,
      data: { connectionId, index, mapping: mapping as Record<string, unknown> }
    }
  } catch (err) {
    return { success: false, error: { message: describeIndexError(err, index) } }
  }
}

export async function getIndexSettings(
  connectionId: string,
  index: string
): Promise<ApiResponse<IndexSettingsResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const settings = await adapter.getIndexSettings(connection, index)
    return {
      success: true,
      data: { connectionId, index, settings: settings as Record<string, unknown> }
    }
  } catch (err) {
    return { success: false, error: { message: describeIndexError(err, index) } }
  }
}

export async function createIndex(
  req: IndexCreateRequest
): Promise<ApiResponse<IndexCreateResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const input: CreateIndexInput = {
      index: req.index,
      settings: req.settings,
      mappings: req.mappings
    }
    const data = await adapter.createIndex(connection, input)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, req.index) }
    }
  }
}

export async function deleteIndex(
  req: IndexDeleteRequest
): Promise<ApiResponse<IndexDeleteResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.deleteIndex(connection, req.index)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, req.index) }
    }
  }
}

// V0.3.1 A-1: close / open lifecycle. The renderer treats close as a
// destructive-with-side-effects operation (the index can no longer be
// read or written until reopened), so the UI wraps the call in a
// Popconfirm. We still surface every server-side error verbatim via
// `describeIndexError` so 404s / 400s show up as actionable messages
// instead of raw stack traces.

export async function closeIndex(
  req: IndexLifecycleRequest
): Promise<ApiResponse<IndexLifecycleResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.closeIndex(connection, req.index)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, req.index) }
    }
  }
}

export async function openIndex(
  req: IndexLifecycleRequest
): Promise<ApiResponse<IndexLifecycleResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.openIndex(connection, req.index)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, req.index) }
    }
  }
}

// V0.3.2 A-2: dynamic-settings edit. The renderer passes the raw
// settings JSON (typically `{ index: { ... } }`); the adapter
// forwards it as-is to `PUT /{index}/_settings`. ES 6.x behaviour
// around static settings differs slightly from later majors; we
// surface the raw error so the user sees exactly why the call
// failed instead of swallowing it.

export async function updateIndexSettings(
  req: IndexUpdateSettingsRequest
): Promise<ApiResponse<IndexUpdateSettingsResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.updateIndexSettings(
      connection,
      req.index,
      req.settings
    )
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, req.index) }
    }
  }
}

// V0.3.3 A-3: append fields to an existing index mapping. ES rejects
// any attempt to change an existing field's type with a 400; we
// surface that message verbatim so the user can immediately see
// which field conflicts.

export async function updateIndexMapping(
  req: IndexUpdateMappingRequest
): Promise<ApiResponse<IndexUpdateMappingResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.updateIndexMapping(
      connection,
      req.index,
      req.mapping
    )
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, req.index) }
    }
  }
}

/* ------------------- V0.3.9 E-7: shard management ------------------- */

// Each shard op runs through the same adapter resolution path as
// the rest of the index service. Reroute failures are wrapped by
// `describeIndexError` so a 400 from ES ("no node named ...") lands
// as a user-readable message instead of a stack trace.

export async function getIndexShards(
  connectionId: string,
  index: string
): Promise<ApiResponse<ShardListResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      connectionId
    )
    const shards: ShardInfo[] = await adapter.listIndexShards(connection, index)
    return {
      success: true,
      data: { connectionId, index, shards }
    }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, index) }
    }
  }
}

export async function relocateShard(
  req: ShardRelocateRequest
): Promise<ApiResponse<ShardRerouteResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.relocateShard(
      connection,
      req.index,
      req.shard,
      req.fromNode,
      req.toNode
    )
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, req.index) }
    }
  }
}

export async function cancelShardAllocation(
  req: ShardCancelRequest
): Promise<ApiResponse<ShardRerouteResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.cancelShardAllocation(
      connection,
      req.index,
      req.shard,
      req.node,
      req.allowPrimary
    )
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, req.index) }
    }
  }
}