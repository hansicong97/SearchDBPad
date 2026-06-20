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
  const root = await elasticsearchRequest<EsRootResponse>(connection, {
    method: 'GET',
    path: '/'
  })
  const version = String(root?.version?.number ?? '0.0.0')
  const parts = version.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const [major = 0, minor = 0, patch = 0] = parts
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