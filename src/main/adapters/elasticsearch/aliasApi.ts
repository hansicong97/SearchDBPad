/**
 * Alias management (V0.3.4 A-4).
 *
 * Three thin wrappers:
 *  - `GET  /_alias`                       -> all aliases for the cluster
 *  - `PUT  /{index}/_alias/{alias}`       -> attach an alias
 *  - `DELETE /{index}/_alias/{alias}`     -> detach an alias
 *
 * The shape of `GET /_alias` is `{ "<index>": { "aliases": { "<alias>": { ... } } } }`
 * for ES 7+ and the same with `_doc` wrapping in ES 6.x. We
 * flatten it into `EsAliasInfo[]` so the renderer can group /
 * filter without knowing about the cluster's nesting style.
 */

import { elasticsearchRequest } from './client'
import type { SearchConnection } from '../../../shared/searchEngine'
import type {
  AliasListResult,
  AliasModifyResult
} from '../../../shared/ipc'

interface RawAliasResponse {
  [indexName: string]: {
    aliases?: Record<string, unknown>
  }
}

function parseAliasResponse(
  connection: SearchConnection,
  raw: unknown
): AliasListResult {
  const root = (raw ?? {}) as RawAliasResponse
  const aliases: AliasListResult['aliases'] = []
  for (const [indexName, block] of Object.entries(root)) {
    if (!block || typeof block !== 'object') continue
    const inner = block.aliases
    if (!inner || typeof inner !== 'object') continue
    for (const aliasName of Object.keys(inner)) {
      aliases.push({ index: indexName, alias: aliasName })
    }
  }
  aliases.sort((a, b) => {
    if (a.index === b.index) return a.alias.localeCompare(b.alias)
    return a.index.localeCompare(b.index)
  })
  return { connectionId: connection.id, aliases }
}

export async function listAliases(
  connection: SearchConnection
): Promise<AliasListResult> {
  const raw = await elasticsearchRequest<RawAliasResponse>(connection, {
    method: 'GET',
    path: '/_alias'
  })
  return parseAliasResponse(connection, raw)
}

export async function addAlias(
  connection: SearchConnection,
  indexName: string,
  aliasName: string
): Promise<AliasModifyResult> {
  await elasticsearchRequest(connection, {
    method: 'PUT',
    path: `/${indexName}/_alias/${encodeURIComponent(aliasName)}`
  })
  return {
    connectionId: connection.id,
    index: indexName,
    alias: aliasName,
    acknowledged: true
  }
}

export async function deleteAlias(
  connection: SearchConnection,
  indexName: string,
  aliasName: string
): Promise<AliasModifyResult> {
  await elasticsearchRequest(connection, {
    method: 'DELETE',
    path: `/${indexName}/_alias/${encodeURIComponent(aliasName)}`
  })
  return {
    connectionId: connection.id,
    index: indexName,
    alias: aliasName,
    acknowledged: true
  }
}
