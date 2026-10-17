import { requireOperation } from '../search/adapter.types'
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
import { toPublicSearchError } from '../search/errors'
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
  IndexMaintenanceRequest,
  IndexMaintenanceResult,
  ShardCancelRequest,
  ShardInfo,
  ShardListResult,
  ShardRelocateRequest,
  ShardRerouteResult
} from '../../shared/ipc'
import type { SearchConnection, SearchIndexInfo, SearchResourceInfo } from '../../shared/searchEngine'
import type { CreateIndexInput, SearchEngineAdapter } from '../search/adapter.types'

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
function describeIndexError(err: unknown, operation: string) {
  const safe = toPublicSearchError(err, operation)
  if (safe.code === 'resource_not_found') safe.message = '请求的索引或资源不存在，请刷新后重试'
  else if (safe.code === 'invalid_request' || safe.code === 'parse_error') safe.message = '索引名或请求参数无效，请检查输入'
  return safe
}

/**
 * The original index IPC predates the engine-neutral resource contract. Keep
 * its Elasticsearch-shaped result for existing renderer callers, but use the
 * generic catalog when an adapter (for example Solr) exposes collections or
 * cores instead of `listIndices`.
 * Follow-up: move the renderer catalog to `resource:list` / SearchResourceInfo
 * before adding resource-specific management. Collections and cores must not
 * acquire index semantics through this compatibility projection.
 */
async function listSearchResources(
  connection: SearchConnection,
  adapter: SearchEngineAdapter
): Promise<SearchIndexInfo[]> {
  if (typeof adapter.listIndices === 'function') {
    return requireOperation(adapter, 'listIndices')(connection)
  }

  const resources = await requireOperation(adapter, 'listResources')(connection)
  return resources.map((resource: SearchResourceInfo) => ({
    name: resource.name,
    health: resource.health,
    status: resource.status,
    docsCount: resource.documentCount
  }))
}

export async function listIndices(
  connectionId: string
): Promise<ApiResponse<IndexListResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const indices = await listSearchResources(connection, adapter)
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
    return { success: false, error: toPublicSearchError(err, 'index:list') }
  }
}

export async function getIndexMapping(
  connectionId: string,
  index: string
): Promise<ApiResponse<IndexMappingResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    let mapping: unknown
    if (typeof adapter.getIndexMapping === 'function') {
      mapping = await requireOperation(adapter, 'getIndexMapping')(connection, index)
    } else {
      // Solr and future collection-based engines expose schema through the
      // generic capability. Preserve the raw response when available so the
      // existing mapping panel can still inspect engine-native JSON.
      const schema = await requireOperation(adapter, 'getSchema')(connection, index)
      mapping = schema.raw ?? {
        fields: schema.fields,
        ...(schema.uniqueKey ? { uniqueKey: schema.uniqueKey } : {})
      }
    }
    return {
      success: true,
      data: { connectionId, index, mapping: mapping as Record<string, unknown> }
    }
  } catch (err) {
    return { success: false, error: describeIndexError(err, 'index:mapping') }
  }
}

export async function getIndexSettings(
  connectionId: string,
  index: string
): Promise<ApiResponse<IndexSettingsResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const settings = await requireOperation(adapter, 'getIndexSettings')(connection, index)
    return {
      success: true,
      data: { connectionId, index, settings: settings as Record<string, unknown> }
    }
  } catch (err) {
    return { success: false, error: describeIndexError(err, 'index:settings') }
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
    const data = await requireOperation(adapter, 'createIndex')(connection, input)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: describeIndexError(err, 'index:create')
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
    const data = await requireOperation(adapter, 'deleteIndex')(connection, req.index)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: describeIndexError(err, 'index:delete')
    }
  }
}

// V0.3.1 A-1: close / open lifecycle. The renderer treats close as a
// destructive-with-side-effects operation (the index can no longer be
// read or written until reopened), so the UI wraps the call in a
// Popconfirm. Errors go through `describeIndexError`, preserving an
// actionable summary without exposing raw server responses.

export async function closeIndex(
  req: IndexLifecycleRequest
): Promise<ApiResponse<IndexLifecycleResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await requireOperation(adapter, 'closeIndex')(connection, req.index)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: describeIndexError(err, 'index:close')
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
    const data = await requireOperation(adapter, 'openIndex')(connection, req.index)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: describeIndexError(err, 'index:open')
    }
  }
}

// V0.3.2 A-2: dynamic-settings edit. The renderer passes the raw
// settings JSON (typically `{ index: { ... } }`); the adapter
// forwards it as-is to `PUT /{index}/_settings`. ES 6.x behaviour
// around static settings differs slightly from later majors; the service
// maps failures to the shared safe error envelope at the IPC boundary.

export async function updateIndexSettings(
  req: IndexUpdateSettingsRequest
): Promise<ApiResponse<IndexUpdateSettingsResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await requireOperation(adapter, 'updateIndexSettings')(
      connection,
      req.index,
      req.settings
    )
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: describeIndexError(err, 'index:updateSettings')
    }
  }
}

// V0.3.3 A-3: append fields to an existing index mapping. ES rejects
// any attempt to change an existing field's type with a 400; we
// return a safe, actionable summary so server details do not cross IPC.

export async function updateIndexMapping(
  req: IndexUpdateMappingRequest
): Promise<ApiResponse<IndexUpdateMappingResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await requireOperation(adapter, 'updateIndexMapping')(
      connection,
      req.index,
      req.mapping
    )
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: describeIndexError(err, 'index:updateMapping')
    }
  }
}

/* ------------------- V0.3.12: 索引维护 ------------------- */

async function runIndexMaintenance(
  req: IndexMaintenanceRequest,
  operation: string,
  invoke: (
    adapter: SearchEngineAdapter,
    connection: SearchConnection
  ) => Promise<IndexMaintenanceResult>
): Promise<ApiResponse<IndexMaintenanceResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await invoke(adapter, connection)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: describeIndexError(err, operation)
    }
  }
}

export function refreshIndex(
  req: IndexMaintenanceRequest
): Promise<ApiResponse<IndexMaintenanceResult>> {
  return runIndexMaintenance(req, 'index:refresh', (adapter, connection) =>
    requireOperation(adapter, 'refreshIndex')(connection, req.index)
  )
}

export function flushIndex(
  req: IndexMaintenanceRequest
): Promise<ApiResponse<IndexMaintenanceResult>> {
  return runIndexMaintenance(req, 'index:flush', (adapter, connection) =>
    requireOperation(adapter, 'flushIndex')(connection, req.index)
  )
}

export function forceMergeIndex(
  req: IndexMaintenanceRequest
): Promise<ApiResponse<IndexMaintenanceResult>> {
  return runIndexMaintenance(req, 'index:forceMerge', (adapter, connection) =>
    requireOperation(adapter, 'forceMergeIndex')(connection, req.index, req.maxNumSegments)
  )
}

export function clearIndexCache(
  req: IndexMaintenanceRequest
): Promise<ApiResponse<IndexMaintenanceResult>> {
  return runIndexMaintenance(req, 'index:clearCache', (adapter, connection) =>
    requireOperation(adapter, 'clearIndexCache')(connection, req.index)
  )
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
    const shards: ShardInfo[] = await requireOperation(adapter, 'listIndexShards')(connection, index)
    return {
      success: true,
      data: { connectionId, index, shards }
    }
  } catch (err) {
    return {
      success: false,
      error: describeIndexError(err, 'shard:list')
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
    const data = await requireOperation(adapter, 'relocateShard')(
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
      error: describeIndexError(err, 'shard:relocate')
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
    const data = await requireOperation(adapter, 'cancelShardAllocation')(
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
      error: describeIndexError(err, 'shard:cancelAllocation')
    }
  }
}
