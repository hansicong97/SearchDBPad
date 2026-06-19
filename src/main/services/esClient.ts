/**
 * Shared helper for building an @elastic/elasticsearch Client from a
 * persisted EsConnection.
 *
 * Phase 3 uses this for cluster and index services. Connection resolution
 * (lookup by id) lives here so the two services stay in sync.
 */

import { Client } from '@elastic/elasticsearch'
import { loadConnections } from '../store/connectionStore'
import type { EsConnection } from '../../shared/ipc'

/** Thrown when a connection id no longer points at a saved connection. */
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

/** Build a fresh ES client for the given connection. */
export function buildEsClient(conn: EsConnection): Client {
  const opts: ConstructorParameters<typeof Client>[0] = {
    node: conn.url
  }
  if (conn.authType === 'basic' && conn.username) {
    opts.auth = {
      username: conn.username,
      password: conn.password ?? ''
    }
  }
  return new Client(opts)
}
