/**
 * Shared helper for building an @elastic/elasticsearch Client from a
 * persisted EsConnection.
 *
 * Phase 3 uses this for cluster and index services. Connection resolution
 * (lookup by id) lives here so the two services stay in sync.
 *
 * Product verification bypass
 * ----------------------------
 * The official @elastic/elasticsearch v8 client performs a strict product
 * check on the first successful response: it expects the server to return
 * an `X-Elastic-Product: Elasticsearch` header. When that header is missing
 * — which happens against older ES clusters (< 7.14), OpenSearch, or any
 * deployment fronted by a reverse proxy that strips the header — the client
 * throws `The client noticed that the server is not Elasticsearch and we
 * do not support this unknown product.`
 *
 * That is overly strict for a generic desktop client. We want to talk to
 * any ES-compatible server the user points us at. The check is performed
 * inside `Transport._request` on `response.headers['x-elastic-product']`,
 * so the lowest-level, least-invasive workaround is to inject the header
 * into the response at the connection layer (one line per request). All
 * higher-level API calls (`cat.indices`, `info`, `search`, `index`, …)
 * inherit the behavior automatically because they all flow through the
 * same transport.
 */

import { Client, SniffingTransport } from '@elastic/elasticsearch'
import { HttpConnection } from '@elastic/transport'
import type {
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestParams,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream
} from '@elastic/transport'
import { loadConnections } from '../store/connectionStore'
import type { EsConnection } from '../../shared/ipc'

const STANDARD_VENDORED_HEADERS = {
  jsonContentType: 'application/json',
  ndjsonContentType: 'application/x-ndjson',
  accept: 'application/json, text/plain'
} as const

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

/**
 * Connection subclass that injects the `x-elastic-product: Elasticsearch`
 * header into every successful response so the official client's product
 * verification passes against ES-compatible servers that don't set the
 * header themselves.
 */
class CompatibleConnection extends HttpConnection {
  override request(
    params: ConnectionRequestParams,
    options: ConnectionRequestOptions
  ): Promise<ConnectionRequestResponse>
  override request(
    params: ConnectionRequestParams,
    options: ConnectionRequestOptionsAsStream
  ): Promise<ConnectionRequestResponseAsStream>
  override async request(
    params: ConnectionRequestParams,
    options: ConnectionRequestOptions | ConnectionRequestOptionsAsStream
  ): Promise<ConnectionRequestResponse | ConnectionRequestResponseAsStream> {
    const response = await super.request(
      params,
      options as ConnectionRequestOptions
    )
    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      response.headers['x-elastic-product'] == null
    ) {
      // Cast: IncomingHttpHeaders is string-indexed but allows our value.
      ;(response.headers as Record<string, string>)['x-elastic-product'] =
        'Elasticsearch'
    }
    return response
  }
}

class CompatibleTransport extends SniffingTransport {
  constructor(opts: ConstructorParameters<typeof SniffingTransport>[0]) {
    super({
      ...opts,
      vendoredHeaders: STANDARD_VENDORED_HEADERS
    })
  }
}

/** Build a fresh ES client for the given connection. */
export function buildEsClient(conn: EsConnection): Client {
  const opts: ConstructorParameters<typeof Client>[0] = {
    node: conn.url,
    Connection: CompatibleConnection,
    Transport: CompatibleTransport
  }
  if (conn.authType === 'basic' && conn.username) {
    opts.auth = {
      username: conn.username,
      password: conn.password ?? ''
    }
  }
  return new Client(opts)
}