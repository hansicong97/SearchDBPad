/** OpenSearch shares the Elasticsearch REST implementation, but not its identity
 *  or version numbering. No service needs to branch on OpenSearch. */
import { elasticsearchAdapter } from '../elasticsearch'
import { elasticsearchRequest } from '../elasticsearch/client'
import { executeTask, getTask, cancelTask } from '../elasticsearch/taskApi'
import type { SearchEngineAdapter } from '../../search/adapter.types'
import { setCachedServerInfo } from '../../search/serverVersionCache'
import { emptySearchEngineCapabilities } from '../../../shared/searchEngine'
import type { SearchConnection, SearchEngineManifest } from '../../../shared/searchEngine'
import type { ConnectionTestResult } from '../../../shared/ipc'
import { detect, parseOpenSearchInfo, type OpenSearchRootResponse } from './detector'
export { detect, parseOpenSearchInfo } from './detector'

export const opensearchManifest: SearchEngineManifest = {
  manifestVersion: 1, adapterVersion: '1.0.0',
  type: 'opensearch',
  displayName: 'OpenSearch',
  protocolFamily: 'elasticsearch-rest',
  supportedVersions: ['1.x', '2.x'],
  authSchemes: ['none', 'basic'],
  resourceModel: 'index',
  queryLanguages: ['elasticsearch-dsl'], transferFormats: ['json', 'csv', 'ndjson'],
  capabilities: {
    ...emptySearchEngineCapabilities(),
    resourceCatalog: true, documentQuery: true, documentWrite: true, schema: true,
    indexManagement: true, bulkTransfer: true, tasks: true, reindex: true, queryMutation: true,
    indices: true, mappings: true, settings: true, aliases: true,
    indexTemplates: true, dslQuery: true, simpleQuery: true,
    importExport: true, openCloseIndex: true, shardManagement: true, maintenance: true, deepPagination: true
  }
}

export async function testConnection(connection: SearchConnection): Promise<ConnectionTestResult> {
  try {
    const root = await elasticsearchRequest<OpenSearchRootResponse>(connection, {method: 'GET', path: '/'})
    const info = parseOpenSearchInfo(root)
    setCachedServerInfo(connection.id, info)
    return {reachable: true, clusterName: root.cluster_name, version: info.version, health: 'unknown'}
  } catch {
    return {reachable: false, message: '无法连接受支持的 OpenSearch 1.x/2.x 服务器，请检查地址、认证和服务器版本。'}
  }
}

export const opensearchAdapter: SearchEngineAdapter = {
  ...elasticsearchAdapter,
  type: 'opensearch', displayName: 'OpenSearch', manifest: opensearchManifest,
  getCapabilities: () => ({...opensearchManifest.capabilities}), detect, testConnection, executeTask, getTask, cancelTask
}
