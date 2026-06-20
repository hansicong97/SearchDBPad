/**
 * In-memory cache for `SearchEngineServerInfo`.
 *
 * V0.3.0: each adapter `detect()` call hits the engine's root endpoint.
 *  For a busy workspace that would mean N+1 round trips on every page
 *  load. This cache memoizes the result per `connectionId` for the
 *  lifetime of the main process.
 *
 * No TTL — server identity is stable within a session. Callers MUST
 *  invoke `invalidateServerInfoCache(id)` when a connection is updated
 *  or deleted; the service layer (Step 4) wires that up.
 *
 * The cache lives in main-process memory only. It is NOT persisted and
 *  is rebuilt on every app launch.
 */

import type { SearchEngineServerInfo } from '../../shared/searchEngine'

const cache = new Map<string, SearchEngineServerInfo>()

export function getCachedServerInfo(
  connectionId: string
): SearchEngineServerInfo | undefined {
  return cache.get(connectionId)
}

export function setCachedServerInfo(
  connectionId: string,
  info: SearchEngineServerInfo
): void {
  cache.set(connectionId, info)
}

/** Drop one entry, or wipe the whole cache if `connectionId` is omitted. */
export function invalidateServerInfoCache(connectionId?: string): void {
  if (connectionId) {
    cache.delete(connectionId)
  } else {
    cache.clear()
  }
}