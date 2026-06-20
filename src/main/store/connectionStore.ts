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

/* ---------------------- Connections ---------------------- */

/** Return all persisted connections, newest first. */
export function loadConnections(): EsConnection[] {
  const list = store.get('connections', [])
  // Sort by createdAt desc so the UI shows the most recent on top.
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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