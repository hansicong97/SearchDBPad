import { requireOperation } from '../search/adapter.types'
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
import { toPublicSearchError } from '../search/errors'

export async function getClusterInfo(
  connectionId: string
): Promise<ApiResponse<ClusterInfo>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const data = await requireOperation(adapter, 'getClusterInfo')(connection)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toPublicSearchError(err, 'cluster:info') }
  }
}

export async function getClusterHealth(
  connectionId: string
): Promise<ApiResponse<ClusterHealth>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const data = await requireOperation(adapter, 'getClusterHealth')(connection)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toPublicSearchError(err, 'cluster:health') }
  }
}
