/**
 * Cluster info / health business logic.
 *
 * Runs in the Electron main process — the only place allowed to talk to
 * Elasticsearch. Uses the @elastic/elasticsearch official client.
 *
 * Phase 3 scope:
 *  - `cluster:info`  -> GET /            (root, returns cluster name + version)
 *  - `cluster:health`-> GET /_cluster/health
 *
 * Both endpoints are invoked together by the workspace page so the index
 * count (returned by the cat API) can be displayed next to the cluster
 * info without a second round-trip from the renderer.
 */

import { buildEsClient, resolveConnection } from './esClient'
import type {
  ApiResponse,
  ClusterHealth,
  ClusterInfo
} from '../../shared/ipc'

/**
 * Extract a short, user-facing error message from any thrown value.
 * Avoids leaking the connection's password (the @elastic/elasticsearch
 * client appends it to URLs in some error paths).
 */
function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/https?:\/\/[^@\s]+@/g, (m) => {
    // Replace the userinfo portion of any URL in the message.
    const schemeEnd = m.indexOf('://') + 3
    return m.slice(0, schemeEnd) + '***:***@'
  })
}

function toInfo(connectionId: string, payload: unknown): ClusterInfo {
  // Shape returned by GET / via @elastic/elasticsearch Client.info()
  const root = payload as {
    cluster_name?: string
    version?: {
      number?: string
      build_flavor?: string
      lucene_version?: string
    }
  }
  return {
    connectionId,
    clusterName: root.cluster_name ?? '',
    version: root.version?.number ?? '',
    distribution: root.version?.build_flavor,
    luceneVersion: root.version?.lucene_version
  }
}

function toHealth(connectionId: string, payload: unknown): ClusterHealth {
  // Shape returned by GET /_cluster/health
  const h = payload as {
    status?: 'green' | 'yellow' | 'red'
    number_of_nodes?: number
    active_shards?: number
    active_primary_shards?: number
    unassigned_shards?: number
  }
  return {
    connectionId,
    status: h.status ?? 'unknown',
    nodeCount: h.number_of_nodes ?? 0,
    activeShards: h.active_shards,
    activePrimaryShards: h.active_primary_shards,
    unassignedShards: h.unassigned_shards
  }
}

export async function getClusterInfo(
  connectionId: string
): Promise<ApiResponse<ClusterInfo>> {
  try {
    const conn = resolveConnection(connectionId)
    const client = buildEsClient(conn)
    const info = await client.info()
    return { success: true, data: toInfo(connectionId, info) }
  } catch (err) {
    return { success: false, error: { message: safeErrorMessage(err) } }
  }
}

export async function getClusterHealth(
  connectionId: string
): Promise<ApiResponse<ClusterHealth>> {
  try {
    const conn = resolveConnection(connectionId)
    const client = buildEsClient(conn)
    const health = await client.cluster.health()
    return { success: true, data: toHealth(connectionId, health) }
  } catch (err) {
    return { success: false, error: { message: safeErrorMessage(err) } }
  }
}
