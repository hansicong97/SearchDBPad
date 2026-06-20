/**
 * Cluster info / health business logic.
 *
 * V0.3.0: routed through the search-engine adapter instead of the
 *  legacy `@elastic/elasticsearch` SDK. The service layer never
 *  imports a concrete adapter — it only knows `SearchEngineAdapter`
 *  via `resolveAdapterByConnectionId`.
 */

import { resolveAdapterByConnectionId } from './searchEngine.service'
import type {
  ApiResponse,
  ClusterHealth,
  ClusterInfo
} from '../../shared/ipc'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function getClusterInfo(
  connectionId: string
): Promise<ApiResponse<ClusterInfo>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const data = await adapter.getClusterInfo(connection)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: { message: errMsg(err) } }
  }
}

export async function getClusterHealth(
  connectionId: string
): Promise<ApiResponse<ClusterHealth>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const data = await adapter.getClusterHealth(connection)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: { message: errMsg(err) } }
  }
}