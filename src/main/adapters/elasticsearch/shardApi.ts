/**
 * Elasticsearch shard management adapter (V0.3.9 E-7).
 *
 * Three operations live here:
 *  - `listIndexShards`     — read-only; one row per shard from
 *                              `GET /_cat/shards/{index}?format=json`
 *  - `relocateShard`        — write; `POST /_cluster/reroute` with
 *                              a `move` command. Requires confirmation
 *                              in the UI because moving a primary off
 *                              a node is destructive.
 *  - `cancelShardAllocation` — write; `POST /_cluster/reroute` with
 *                              a `cancel` command. Targets shards
 *                              that are currently UNASSIGNED (replicas
 *                              that failed to allocate, etc.).
 *
 * The ES API for `move` / `cancel` returns a 200 even when the
 * reroute command produces no state change (e.g. moving a shard
 * from a node to itself), but the body always reports
 * `acknowledged: true`. We forward that boolean verbatim so the UI
 * can decide how to surface "no-op" cases.
 */

import { elasticsearchRequest } from './client'
import type { SearchConnection } from '../../../shared/searchEngine'
import type {
  ShardInfo,
  ShardRerouteResult
} from '../../../shared/ipc'

interface CatShardRow {
  shard?: string
  prirep?: string
  state?: string
  docs?: string
  store?: string
  ip?: string
  node?: string
  'unassigned.reason'?: string
  'completion.percent'?: string
}

interface RerouteResponse {
  acknowledged?: boolean
}

function toShardInfo(row: CatShardRow): ShardInfo | null {
  if (row.shard === undefined) return null
  return {
    shard: row.shard,
    prirep: row.prirep ?? '',
    state: row.state ?? '',
    docs: row.docs ?? '',
    store: row.store ?? '',
    ip: row.ip ?? '',
    node: row.node ?? '',
    unassignedReason: row['unassigned.reason'] || undefined,
    completionPercent: row['completion.percent'] || undefined
  }
}

/** Read the shard table for a single index. The result is sorted
 *  by `shard` then `prirep` (primary before replica) so the UI
 *  presents a stable, scannable list. */
export async function listIndexShards(
  connection: SearchConnection,
  indexName: string
): Promise<ShardInfo[]> {
  const rows = await elasticsearchRequest<CatShardRow[]>(connection, {
    method: 'GET',
    path: `/_cat/shards/${indexName}`,
    query: { format: 'json', bytes: 'b' }
  })
  const list = (Array.isArray(rows) ? rows : [])
    .map(toShardInfo)
    .filter((x): x is ShardInfo => x !== null)
  list.sort((a, b) => {
    const s = Number.parseInt(a.shard, 10)
    const t = Number.parseInt(b.shard, 10)
    if (Number.isFinite(s) && Number.isFinite(t) && s !== t) return s - t
    // Primary before replica when shard numbers tie.
    if (a.prirep === b.prirep) return 0
    if (a.prirep === 'p') return -1
    if (b.prirep === 'p') return 1
    return 0
  })
  return list
}

/** Move a started shard from one node to another. Both nodes must
 *  be cluster members; ES returns 400 with a descriptive error if
 *  either name is unknown, which the service layer surfaces
 *  verbatim. */
export async function relocateShard(
  connection: SearchConnection,
  indexName: string,
  shard: string,
  fromNode: string,
  toNode: string
): Promise<ShardRerouteResult> {
  const body = {
    commands: [
      {
        move: {
          index: indexName,
          shard,
          from_node: fromNode,
          to_node: toNode
        }
      }
    ]
  }
  const res = await elasticsearchRequest<RerouteResponse>(connection, {
    method: 'POST',
    path: '/_cluster/reroute',
    body
  })
  return {
    connectionId: connection.id,
    index: indexName,
    shard,
    acknowledged: res?.acknowledged ?? false
  }
}

/** Cancel the allocation of an unassigned shard. By default this
 *  refuses to cancel a primary (ES enforces that itself; we mirror
 *  the default by passing `allow_primary: false` unless the caller
 *  explicitly opts in). */
export async function cancelShardAllocation(
  connection: SearchConnection,
  indexName: string,
  shard: string,
  node: string,
  allowPrimary?: boolean
): Promise<ShardRerouteResult> {
  const cmd: Record<string, unknown> = {
    index: indexName,
    shard,
    node
  }
  if (allowPrimary) {
    cmd.allow_primary = true
  }
  const body = { commands: [{ cancel: cmd }] }
  const res = await elasticsearchRequest<RerouteResponse>(connection, {
    method: 'POST',
    path: '/_cluster/reroute',
    body
  })
  return {
    connectionId: connection.id,
    index: indexName,
    shard,
    acknowledged: res?.acknowledged ?? false
  }
}