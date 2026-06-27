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

/** Body shape accepted by `PUT /{index}` / `PUT /{index}/_mapping`.
 *  V0.3.3 splits `UpdateMappingBody` out so the `_doc` wrapping for
 *  ES 6.x can stay isolated from `CreateIndexBody`. */
export interface CreateIndexBody {
  settings?: Record<string, unknown>
  mappings?: Record<string, unknown>
}

/** Body shape accepted by `PUT /{index}/_mapping`. Caller passes a
 *  shape that already has `properties` (or any other ES field) at
 *  the top level — the adapter wraps it in `_doc` for ES 6.x. */
export interface UpdateMappingBody {
  properties?: Record<string, unknown>
  [key: string]: unknown
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

/** V0.3.3 A-3: same idea as `normalizeCreateIndexBodyForEsVersion`,
 *  but for the `PUT /{index}/_mapping` body. ES 6.x wants the
 *  mapping wrapped under a `_doc` type key when the index was
 *  originally created via the typeless API; ES 7+ uses a flat
 *  top-level mapping.
 *
 *  The renderer always sends a top-level `{ properties: {...} }`
 *  body so it can stay engine-agnostic. This helper only ever
 *  touches the `properties` key — if callers want to pass other
 *  ES 6.x fields they have to do it themselves. */
export function normalizeUpdateMappingBodyForEsVersion(
  body: UpdateMappingBody,
  info: SearchEngineServerInfo
): Record<string, unknown> {
  if (info.major > 6) return body
  if (!body || typeof body !== 'object') return body
  if ('_doc' in body) return body
  // ES 6.x: wrap under `_doc` and forward only `properties` (plus any
  // sibling keys the renderer explicitly set on the inner object).
  // We deliberately avoid copying arbitrary top-level keys so a
  // future caller adding, say, `_meta` to the top level does not
  // silently sneak through to ES 6.x.
  const inner: Record<string, unknown> = {}
  if ('properties' in body) inner.properties = body.properties
  return { _doc: inner }
}