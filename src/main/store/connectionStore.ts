/**
 * Connection persistence layer.
 *
 * Wraps electron-store to read/write the local connection list AND
 * connection folder list. The store file lives in the platform's
 * userData directory (managed by electron), so saved data survives
 * application restarts.
 *
 * Phase 2 scope: pure local persistence for connections.
 * Phase 15 (UI update): adds folder CRUD alongside connections.
 */

import Store from 'electron-store'
import type { ConnectionFolder, EsConnection } from '../../shared/ipc'
import type { SearchEngineType } from '../../shared/searchEngine'

interface ConnectionStoreSchema {
  connections: EsConnection[]
  folders: ConnectionFolder[]
}

const store = new Store<ConnectionStoreSchema>({
  name: 'connections',
  defaults: {
    connections: [],
    folders: []
  }
})

/** Shape of a connection row as it lives in `electron-store`. Pre-V0.3.0
 *  entries may not carry `engineType`, so the union makes the field
 *  optional. Reads flow through `ensureEngineType` to normalize. */
type PersistedConnection =
  | EsConnection
  | (Omit<EsConnection, 'engineType'> & { engineType?: SearchEngineType })

/** V0.3.0: legacy connections persisted before `engineType` existed
 *  are normalized to the only supported engine today. The backfill is
 *  read-only — the field is only persisted back when the user edits
 *  the connection via the connection service. */
function ensureEngineType(c: PersistedConnection): EsConnection {
  if (c.engineType) return c as EsConnection
  return { ...c, engineType: 'elasticsearch' }
}

/* ---------------------- Connections ---------------------- */

/** Return all persisted connections, newest first. Entries missing the
 *  V0.3.0 `engineType` field are backfilled to `'elasticsearch'`. */
export function loadConnections(): EsConnection[] {
  const list = store.get('connections', []) as PersistedConnection[]
  // Sort by createdAt desc so the UI shows the most recent on top.
  return [...list]
    .map(ensureEngineType)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Persist the full connection list. */
export function saveConnections(list: EsConnection[]): void {
  store.set('connections', list)
}

/* ---------------------- Folders ---------------------- */

/** Return all persisted folders, oldest first so the UI keeps a stable
 *  ordering of user-defined groups. */
export function loadConnectionFolders(): ConnectionFolder[] {
  const list = store.get('folders', [])
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Persist the full folder list. */
export function saveConnectionFolders(list: ConnectionFolder[]): void {
  store.set('folders', list)
}

/* ---------------------- Lookup by id ---------------------- */

/** Thrown when a connection id no longer points at a saved connection.
 *  Was previously exported from `services/esClient.ts`; moved here in
 *  V0.3.0 Step 4 so the adapter-resolution layer
 *  (`searchEngine.service.ts`) can import it without dragging the
 *  legacy SDK file along. */
export class ConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`未找到连接: ${connectionId}`)
    this.name = 'ConnectionNotFoundError'
  }
}

/** Look up a persisted EsConnection by id. */
export function resolveConnection(connectionId: string): EsConnection {
  const list = loadConnections()
  const found = list.find((c) => c.id === connectionId)
  if (!found) {
    throw new ConnectionNotFoundError(connectionId)
  }
  return found
}