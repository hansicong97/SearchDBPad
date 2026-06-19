/**
 * Connection persistence layer.
 *
 * Wraps electron-store to read/write the local connection list. The store
 * file lives in the platform's userData directory (managed by electron),
 * so saved connections survive application restarts.
 *
 * Phase 2 scope only: this module does not know how to talk to ES. It is
 * pure local persistence.
 */

import Store from 'electron-store'
import type { EsConnection } from '../../shared/ipc'

interface ConnectionStoreSchema {
  connections: EsConnection[]
}

const store = new Store<ConnectionStoreSchema>({
  name: 'connections',
  defaults: {
    connections: []
  }
})

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
