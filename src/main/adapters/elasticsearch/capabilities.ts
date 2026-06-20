/**
 * Elasticsearch version → capability table.
 *
 * V0.3.0 §8.4. Per-version quirks live here so the rest of the adapter
 *  can branch on stable booleans rather than raw major-version numbers.
 *  All other adapter files consume this — only `versionCompat.ts` is
 *  allowed to inspect `info.major` directly, and only for shape-level
 *  request normalization.
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
  /** `PUT /{index}/{type}/_doc/{id}` — ES 6.x style. */
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
  const major = info.major
  return {
    supportsMappingTypes: major <= 6,
    requiresDocTypeForMapping: major <= 6,
    supportsTypelessDocumentApi: major >= 7,
    supportsTypedDocumentApi: major <= 7,
    supportsSeqNoPrimaryTerm: major >= 7,
    supportsRuntimeFields: major >= 7,
    supportsDataStreams: major >= 7
  }
}