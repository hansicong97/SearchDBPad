/**
 * Elasticsearch adapter — V0.3.0 §8.
 *
 * The single export resolved by `adapterRegistry.ts` for
 * `engineType === 'elasticsearch'`. Every other file in this folder
 * is an internal implementation detail; the rest of the codebase
 * talks to us only through `SearchEngineAdapter`.
 *
 * The shape is intentionally boring — just a wiring object. The real
 * version branching lives in `versionCompat.ts`; the real capability
 * table in `capabilities.ts`; the real HTTP transport in `client.ts`.
 */

import type { SearchEngineAdapter } from '../../search/adapter.types'
import { emptySearchEngineCapabilities, type SearchEngineManifest, type SearchConnection, type SearchQueryInput, type SearchQueryResult, type SearchEngineCapabilities } from '../../../shared/searchEngine'
import { SearchEngineError } from '../../search/errors'

import { detect } from './detector'
import { getCachedServerInfo, setCachedServerInfo } from '../../search/serverVersionCache'
import { getElasticsearchCapabilities } from './capabilities'
import {
  testConnection,
  getClusterInfo,
  getClusterHealth
} from './clusterApi'
import {
  listIndices,
  getIndexMapping,
  getIndexSettings,
  createIndex,
  deleteIndex,
  closeIndex,
  openIndex,
  updateIndexSettings,
  updateIndexMapping,
  refreshIndex,
  flushIndex,
  forceMergeIndex,
  clearIndexCache
} from './indexApi'
import {
  listAliases,
  addAlias,
  deleteAlias
} from './aliasApi'
import {
  listIndexTemplates,
  getIndexTemplate,
  createIndexTemplate,
  deleteIndexTemplate
} from './templateApi'
import {
  searchDocuments,
  createDocument,
  updateDocument,
  deleteDocument
} from './documentApi'
import { importDocuments } from './importApi'
import { exportDocuments, exportBatches } from './exportApi'
import { executeTask, getTask, cancelTask } from './taskApi'
import { getSchema } from './schemaApi'
import {
  listIndexShards,
  relocateShard,
  cancelShardAllocation
} from './shardApi'

export const elasticsearchManifest: SearchEngineManifest = {
  manifestVersion: 1,
  adapterVersion: '1.0.0',
  type: 'elasticsearch',
  displayName: 'Elasticsearch',
  protocolFamily: 'elasticsearch-rest',
  supportedVersions: ['6.x', '7.x', '8.x', '9.x'],
  authSchemes: ['none', 'basic'],
  resourceModel: 'index',
  queryLanguages: ['elasticsearch-dsl'],
  transferFormats: ['json', 'csv', 'ndjson'],
  capabilities: {
    ...emptySearchEngineCapabilities(),
    resourceCatalog: true, documentQuery: true, documentWrite: true, schema: true,
    indexManagement: true, bulkTransfer: true, indices: true, mappings: true,
    settings: true, aliases: true, indexTemplates: true, dslQuery: true,
    simpleQuery: true, importExport: true, openCloseIndex: true,
    shardManagement: true, maintenance: true, deepPagination: true,
    tasks: true, reindex: true, queryMutation: true
  }
}

async function queryDocuments(connection: SearchConnection, input: SearchQueryInput): Promise<SearchQueryResult> {
  if (input.queryLanguage !== 'elasticsearch-dsl') {
    throw new SearchEngineError({engineType: connection.engineType, code: 'unsupported_capability', message: 'This adapter accepts Elasticsearch DSL queries only.'})
  }
  const result = await searchDocuments(connection, { index: input.resourceName, query: input.query, signal: input.signal })
  return { connectionId: connection.id, resourceName: input.resourceName, requestSeq: input.requestSeq,
    took: result.took, total: result.total, totalRelation: result.totalRelation, hits: result.hits, raw: result.raw }
}

export const elasticsearchAdapter: SearchEngineAdapter = {
  type: 'elasticsearch',
  displayName: 'Elasticsearch',
  manifest: elasticsearchManifest,
  getCapabilities: async (connection?: SearchConnection): Promise<SearchEngineCapabilities> => {
    if (!connection) return { ...elasticsearchManifest.capabilities }
    let info = getCachedServerInfo(connection.id)
    if (!info) {
      info = await detect(connection)
      setCachedServerInfo(connection.id, info)
    }
    const versionFeatures = getElasticsearchCapabilities(info)
    return { ...elasticsearchManifest.capabilities, versionFeatures: { ...versionFeatures } }
  },
  listResources: async (connection) => (await listIndices(connection)).map((index) => ({
    name: index.name, kind: 'index' as const, status: index.status, health: index.health, documentCount: index.docsCount, metadata: { ...index }
  })),
  queryDocuments,
  getSchema,

  detect,
  testConnection,
  getClusterInfo,
  getClusterHealth,

  listIndices,
  getIndexMapping,
  getIndexSettings,

  searchDocuments,
  createDocument,
  updateDocument,
  deleteDocument,

  createIndex,
  deleteIndex,
  closeIndex,
  openIndex,
  updateIndexSettings,
  updateIndexMapping,

  // V0.3.12: 索引维护。
  refreshIndex,
  flushIndex,
  forceMergeIndex,
  clearIndexCache,

  listAliases,
  addAlias,
  deleteAlias,

  listIndexTemplates,
  getIndexTemplate,
  createIndexTemplate,
  deleteIndexTemplate,

  importDocuments,
  exportDocuments,
  exportBatches,
  executeTask,
  getTask,
  cancelTask,

  // V0.3.9 E-7: shard management.
  listIndexShards,
  relocateShard,
  cancelShardAllocation
}
