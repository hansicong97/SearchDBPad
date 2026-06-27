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

import { detect } from './detector'
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
  updateIndexMapping
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
import { exportDocuments } from './exportApi'
import {
  listIndexShards,
  relocateShard,
  cancelShardAllocation
} from './shardApi'

export const elasticsearchAdapter: SearchEngineAdapter = {
  type: 'elasticsearch',
  displayName: 'Elasticsearch',

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

  listAliases,
  addAlias,
  deleteAlias,

  listIndexTemplates,
  getIndexTemplate,
  createIndexTemplate,
  deleteIndexTemplate,

  importDocuments,
  exportDocuments,

  // V0.3.9 E-7: shard management.
  listIndexShards,
  relocateShard,
  cancelShardAllocation
}