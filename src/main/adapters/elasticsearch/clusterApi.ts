/**
 * Cluster info / health / connection-test endpoints.
 *
 *  Three small wrappers around `GET /` and `GET /_cluster/health`.
 *  `testConnection` issues both in parallel and folds partial failures
 *  into a single `ConnectionTestResult` — a network error on the root
 *  endpoint means the cluster is unreachable, even if `/health` came
 *  back, but a missing health response is acceptable.
 */

import { elasticsearchRequest } from './client'
import type { SearchConnection } from '../../../shared/searchEngine'
import type {
  ClusterHealth,
  ClusterInfo,
  ConnectionTestResult
} from '../../../shared/ipc'

interface EsRootResponse {
  cluster_name?: string
  version?: {
    number?: string
    distribution?: string
    build_flavor?: string
    lucene_version?: string
  }
}

interface EsHealthResponse {
  status?: 'green' | 'yellow' | 'red'
  number_of_nodes?: number
  active_shards?: number
  active_primary_shards?: number
  unassigned_shards?: number
}

export async function getClusterInfo(
  connection: SearchConnection
): Promise<ClusterInfo> {
  const root = await elasticsearchRequest<EsRootResponse>(connection, {
    method: 'GET',
    path: '/'
  })
  return {
    connectionId: connection.id,
    clusterName: root.cluster_name ?? '',
    version: root.version?.number ?? '',
    distribution: root.version?.distribution ?? root.version?.build_flavor,
    luceneVersion: root.version?.lucene_version
  }
}

export async function getClusterHealth(
  connection: SearchConnection
): Promise<ClusterHealth> {
  const h = await elasticsearchRequest<EsHealthResponse>(connection, {
    method: 'GET',
    path: '/_cluster/health'
  })
  return {
    connectionId: connection.id,
    status: h.status ?? 'unknown',
    nodeCount: h.number_of_nodes ?? 0,
    activeShards: h.active_shards,
    activePrimaryShards: h.active_primary_shards,
    unassignedShards: h.unassigned_shards
  }
}

export async function testConnection(
  connection: SearchConnection
): Promise<ConnectionTestResult> {
  const [rootResult, healthResult] = await Promise.allSettled([
    elasticsearchRequest<EsRootResponse>(connection, {
      method: 'GET',
      path: '/'
    }),
    elasticsearchRequest<EsHealthResponse>(connection, {
      method: 'GET',
      path: '/_cluster/health'
    })
  ])
  if (rootResult.status === 'rejected') {
    return {
      reachable: false,
      message: `无法连接 Elasticsearch: ${(rootResult.reason as Error).message}`
    }
  }
  const root = rootResult.value
  const health =
    healthResult.status === 'fulfilled' ? healthResult.value : undefined
  return {
    reachable: true,
    clusterName: root.cluster_name,
    version: root.version?.number,
    health: health?.status ?? 'unknown'
  }
}