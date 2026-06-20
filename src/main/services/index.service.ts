/**
 * Index list / mapping / settings / create / delete.
 *
 * V0.3.0: routed through the adapter. The service still returns the
 *  legacy `EsIndexInfo` shape so the renderer (which sorts on
 *  `docsDeleted` and `storeSize`) keeps working unchanged. The
 *  adapter's engine-agnostic `SearchIndexInfo` does NOT carry
 *  `docsDeleted` or `uuid`, so those fields fall back to `0` and
 *  `undefined` respectively. See `searchInfoToEsIndex` for the
 *  exact mapping.
 */

import { resolveAdapterByConnectionId } from './searchEngine.service'
import type {
  ApiResponse,
  EsIndexInfo,
  IndexCreateRequest,
  IndexCreateResult,
  IndexDeleteRequest,
  IndexDeleteResult,
  IndexListResult,
  IndexMappingResult,
  IndexSettingsResult
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
 *  renderer-facing `EsIndexInfo`. The mapping is lossy on
 *  `docsDeleted` and `uuid` — both are ES-specific fields that the
 *  generic shape deliberately omits. The renderer's `docsDeleted`
 *  sort degenerates to a no-op until those fields are added back. */
function searchInfoToEsIndex(info: SearchIndexInfo): EsIndexInfo | null {
  if (!info.name) return null
  return {
    index: info.name,
    health: (info.health ?? 'unknown') as EsIndexInfo['health'],
    status: (info.status ?? 'unknown') as EsIndexInfo['status'],
    docsCount: info.docsCount ?? 0,
    docsDeleted: 0,
    storeSize: toInt(info.storeSize),
    pri: info.pri ?? 0,
    rep: info.rep ?? 0,
    uuid: undefined
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