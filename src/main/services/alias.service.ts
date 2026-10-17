import { requireOperation } from '../search/adapter.types'
/**
 * Alias business logic (V0.3.4 A-4).
 *
 * Thin pass-through to the adapter. We only translate thrown
 * errors into the project's standard safe `ApiResponse` envelope. Adapter
 * messages and details can contain server responses or connection data and
 * must not cross the IPC boundary verbatim.
 */

import { resolveAdapterByConnectionId } from './searchEngine.service'
import { toPublicSearchError } from '../search/errors'
import type {
  AliasListResult,
  AliasModifyRequest,
  AliasModifyResult,
  ApiResponse
} from '../../shared/ipc'

export async function listAliases(
  connectionId: string
): Promise<ApiResponse<AliasListResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      connectionId
    )
    const data = await requireOperation(adapter, 'listAliases')(connection)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toPublicSearchError(err, 'alias:list') }
  }
}

export async function addAlias(
  req: AliasModifyRequest
): Promise<ApiResponse<AliasModifyResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await requireOperation(adapter, 'addAlias')(connection, req.index, req.alias)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toPublicSearchError(err, 'alias:create') }
  }
}

export async function deleteAlias(
  req: AliasModifyRequest
): Promise<ApiResponse<AliasModifyResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await requireOperation(adapter, 'deleteAlias')(connection, req.index, req.alias)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toPublicSearchError(err, 'alias:delete') }
  }
}
