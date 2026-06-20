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
  deleteIndex
} from './indexApi'
import {
  searchDocuments,
  createDocument,
  updateDocument,
  deleteDocument
} from './documentApi'
import { importDocuments } from './importApi'
import { exportDocuments } from './exportApi'

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

  importDocuments,
  exportDocuments
}