/**
 * Elasticsearch version detection — V0.3.0 §8.3.
 *
 *  Issues `GET /` against the configured cluster and parses the
 *  `version.number` field. The result feeds the capability table and
 *  the version-compat layer; the service cache
 *  (`src/main/search/serverVersionCache.ts`) memoizes it so we don't
 *  re-hit the root endpoint on every call.
 */

import { elasticsearchRequest } from './client'
import { SearchEngineError } from '../../search/errors'
import { detect as detectOpenSearch } from '../opensearch/detector'
import type {
  SearchConnection,
  SearchEngineServerInfo
} from '../../../shared/searchEngine'

interface EsRootResponse {
  cluster_name?: string
  version?: {
    number?: string
    distribution?: string
    build_flavor?: string
    lucene_version?: string
  }
}

export async function detect(
  connection: SearchConnection
): Promise<SearchEngineServerInfo> {
  // This internal detector also serves REST-compatible helpers on a cold
  // version cache. Preserve OpenSearch identity and independent numbering.
  if (connection.engineType === 'opensearch') return detectOpenSearch(connection)
  const root = await elasticsearchRequest<EsRootResponse>(connection, {
    method: 'GET',
    path: '/'
  })
  const version = String(root?.version?.number ?? '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  const major = match ? Number(match[1]) : 0
  const minor = match ? Number(match[2]) : 0
  const patch = match ? Number(match[3]) : 0
  if (!match || major < 6 || major > 9 || root?.version?.distribution === 'opensearch') {
    throw new SearchEngineError({engineType: 'elasticsearch', code: 'unsupported_capability', message: '服务器版本或发行版不属于受支持的 Elasticsearch 6.x-9.x。'})
  }
  return {
    engineType: 'elasticsearch',
    engineName: 'Elasticsearch',
    version,
    major,
    minor,
    patch,
    distribution:
      root?.version?.distribution ?? root?.version?.build_flavor,
    compatibleRange: '6.x-9.x'
  }
}
