/**
 * Alias business logic (V0.3.4 A-4).
 *
 * Thin pass-through to the adapter. We only translate thrown
 * errors into the project's standard `ApiResponse` envelope so the
 * renderer can show server messages verbatim (e.g. 404 on a stale
 * alias name).
 */

import { resolveAdapterByConnectionId } from './searchEngine.service'
import type {
  AliasListResult,
  AliasModifyRequest,
  AliasModifyResult,
  ApiResponse
} from '../../shared/ipc'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function listAliases(
  connectionId: string
): Promise<ApiResponse<AliasListResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      connectionId
    )
    const data = await adapter.listAliases(connection)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: { message: errMsg(err) } }
  }
}

export async function addAlias(
  req: AliasModifyRequest
): Promise<ApiResponse<AliasModifyResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.addAlias(connection, req.index, req.alias)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: { message: errMsg(err) } }
  }
}

export async function deleteAlias(
  req: AliasModifyRequest
): Promise<ApiResponse<AliasModifyResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.deleteAlias(connection, req.index, req.alias)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: { message: errMsg(err) } }
  }
}
