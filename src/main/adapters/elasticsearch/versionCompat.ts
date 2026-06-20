/**
 * Elasticsearch version-specific request-body / URL normalization.
 *
 * V0.3.0 §8.5. The ONLY place in the adapter that inspects
 *  `info.major` for request-shape decisions. Every other call site
 *  consumes `ElasticsearchCapabilities` from `./capabilities.ts`.
 *
 * Today the file holds a single concrete helper: ES 6.x wants mappings
 *  under a `_doc` type key, ES 7+ wants them at the top level. Future
 *  quirks (e.g. ES 9.x parameter tightening) land here too.
 */

import type { SearchEngineServerInfo } from '../../../shared/searchEngine'

/** Body shape accepted by `PUT /{index}`. */
export interface CreateIndexBody {
  settings?: Record<string, unknown>
  mappings?: Record<string, unknown>
}

/** Normalize a `PUT /{index}` request body for the target ES version.
 *
 *  - ES 7+: pass through (`{ mappings: { properties: ... } }`).
 *  - ES 6.x: if the caller already wrapped mappings under `_doc`,
 *    pass through; otherwise wrap. The wrapping is required because
 *    ES 6.x rejects top-level `mappings.properties` when the index
 *    was created via the typeless API — `mapper_parsing_exception`.
 */
export function normalizeCreateIndexBodyForEsVersion(
  body: CreateIndexBody,
  info: SearchEngineServerInfo
): CreateIndexBody {
  if (info.major > 6) return body
  if (!body || typeof body !== 'object') return body
  const mappings = body.mappings
  if (!mappings || typeof mappings !== 'object') return body
  if ('_doc' in mappings) return body
  body.mappings = { _doc: mappings }
  return body
}