/**
 * Elasticsearch version → capability table.
 *
 * Protocol features used by request normalization and connection-level
 * capability reporting. Product operations remain available across the
 * supported ES 6-9 range even when their request shape differs.
 */

import type { SearchEngineServerInfo } from '../../../shared/searchEngine'

export interface ElasticsearchCapabilities {
  /** ES 6.x accepts (and ES 7+ ignores) explicit `_doc` types in
   *  mapping bodies. */
  supportsMappingTypes: boolean
  /** Whether mappings must live under a type key. ES 6.x only. */
  requiresDocTypeForMapping: boolean
  /** `POST /{index}/_doc` (no type) — ES 7+ default. */
  supportsTypelessDocumentApi: boolean
  /** Typed document endpoints (removed in ES 8). */
  supportsTypedDocumentApi: boolean
  /** Optimistic concurrency control (if_seq_no / if_primary_term). */
  supportsSeqNoPrimaryTerm: boolean
  /** Whether `runtime_mappings` can be declared. ES 7.11+. */
  supportsRuntimeFields: boolean
  /** Whether `_data_stream` APIs are recognized. ES 7.9+. */
  supportsDataStreams: boolean
}

export function getElasticsearchCapabilities(
  info: SearchEngineServerInfo
): ElasticsearchCapabilities {
  const major = info.engineType === 'opensearch' ? 7 : info.major
  return {
    supportsMappingTypes: major <= 6,
    requiresDocTypeForMapping: major <= 6,
    supportsTypelessDocumentApi: major >= 7,
    supportsTypedDocumentApi: major <= 7,
    supportsSeqNoPrimaryTerm: major >= 7 || (major === 6 && info.minor >= 7),
    // OpenSearch has its own derived-field APIs; ES runtime_mappings is not
    // part of the shared REST contract.
    supportsRuntimeFields: info.engineType !== 'opensearch' && (major > 7 || (major === 7 && info.minor >= 11)),
    supportsDataStreams: info.engineType === 'opensearch' || major > 7 || (major === 7 && info.minor >= 9)
  }
}
