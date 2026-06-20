/**
 * Search engine resolution helper.
 *
 * V0.3.0 §9.1: the single function every service uses to "go from a
 *  connectionId to a ready-to-call adapter". Centralising this here
 *  keeps services engine-agnostic — they never import
 *  `src/main/adapters/<engine>/*` directly.
 *
 *  This file replaces the role the legacy `services/esClient.ts`
 *  played for SDK-based clients. `resolveConnection` itself now lives
 *  in `store/connectionStore.ts` (moved there in Step 4 so it can be
 *  imported without pulling in the rest of the old SDK shim).
 *
 *  Step 5 also adds `searchEngineDetect`, the explicit IPC handler
 *  exposed via `search-engine:detect`. It deliberately does NOT use
 *  the version cache: callers want a fresh probe (e.g. "is the URL
 *  still valid?"). The fresh result is then written into the cache so
 *  the next implicit detect (e.g. via `createIndex`) skips the round
 *  trip.
 */

import { resolveConnection } from '../store/connectionStore'
import { getSearchEngineAdapter } from '../search/adapterRegistry'
import { setCachedServerInfo } from '../search/serverVersionCache'
import type { ApiResponse } from '../../shared/ipc'
import type {
  SearchConnection,
  SearchEngineServerInfo
} from '../../shared/searchEngine'
import type { SearchEngineAdapter } from '../search/adapter.types'

export async function resolveAdapterByConnectionId(
  connectionId: string
): Promise<{
  connection: SearchConnection
  adapter: SearchEngineAdapter
}> {
  const connection = resolveConnection(connectionId)
  const adapter = await getSearchEngineAdapter(connection.engineType)
  return { connection, adapter }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** V0.3.0 §10.2 — explicit `GET /` probe. Always issues the request
 *  (does not consult the cache) so the caller sees a live result;
 *  the fresh result is then stored so implicit detects benefit. */
export async function searchEngineDetect(
  connectionId: string
): Promise<ApiResponse<SearchEngineServerInfo>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const info = await adapter.detect(connection)
    setCachedServerInfo(connectionId, info)
    return { success: true, data: info }
  } catch (err) {
    return {
      success: false,
      error: { message: errMsg(err) }
    }
  }
}