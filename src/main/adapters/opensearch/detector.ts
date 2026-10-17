import { elasticsearchRequest } from '../elasticsearch/client'
import { SearchEngineError } from '../../search/errors'
import { setCachedServerInfo } from '../../search/serverVersionCache'
import type { SearchConnection, SearchEngineServerInfo } from '../../../shared/searchEngine'

export interface OpenSearchRootResponse {
  cluster_name?: string
  version?: {number?: string; distribution?: string; lucene_version?: string}
  tagline?: string
}

export function parseOpenSearchInfo(root: OpenSearchRootResponse): SearchEngineServerInfo {
  const version = root.version?.number ?? ''
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  if (root.version?.distribution !== 'opensearch' || !match) {
    throw new SearchEngineError({engineType: 'opensearch', code: 'unsupported_capability', message: '该服务器未返回有效的 OpenSearch distribution/version，请检查连接引擎类型。'})
  }
  const major = Number(match[1]), minor = Number(match[2]), patch = Number(match[3])
  if (major !== 1 && major !== 2) {
    throw new SearchEngineError({engineType: 'opensearch', code: 'unsupported_capability', message: '当前 OpenSearch adapter 支持 1.x 和 2.x。'})
  }
  return {engineType: 'opensearch', engineName: 'OpenSearch', version, major, minor, patch, distribution: 'opensearch', compatibleRange: '1.x-2.x'}
}

export async function detect(connection: SearchConnection): Promise<SearchEngineServerInfo> {
  const info = parseOpenSearchInfo(await elasticsearchRequest<OpenSearchRootResponse>(connection, {method: 'GET', path: '/'}))
  setCachedServerInfo(connection.id, info)
  return info
}
