/**
 * Generic search engine types.
 *
 * V0.3.0 introduces a "Search Engine Adapter" architecture so future
 * search engines (Solr / OpenSearch / Meilisearch / Typesense) can plug
 * in without rewriting business services. This file holds the engine-
 * agnostic types shared between main / preload / renderer.
 *
 * Engine-specific quirks (URL shape, version differences, request
 * signing, etc.) MUST stay inside `src/main/adapters/<engine>/` and
 * never leak into `src/shared/`.
 */

/** Supported search engine types. Add a new literal here when a new
 *  adapter lands, then wire it through `src/main/search/adapterRegistry.ts`.
 *  V0.3.0 only ships the Elasticsearch adapter. */
export type SearchEngineType = 'elasticsearch'

/** Authentication schemes understood by adapters. Today only
 *  Elasticsearch consumes these; the shape is engine-agnostic so
 *  future adapters can declare their own variants without changing
 *  shared types. */
export type SearchAuthType = 'none' | 'basic'

/** A persisted connection to a search engine. The renderer / preload
 *  continue to use the `EsConnection` alias exported from `ipc.ts`, so
 *  IPC payloads do not change in V0.3.0.
 *
 *  Pre-V0.3.0 entries persisted without `engineType` are backfilled to
 *  `'elasticsearch'` on read by `src/main/store/connectionStore.ts`. */
export interface SearchConnection {
  id: string
  name: string
  engineType: SearchEngineType
  url: string
  authType: SearchAuthType
  username?: string
  password?: string
  /** Folder id this connection belongs to. `null` / `undefined` means
   *  the system "未分组" bucket — folders with no `folderId` land there
   *  for backward compatibility with phase 2 entries. */
  folderId?: string | null
  createdAt: string
  updatedAt: string
}

/** Output of the engine's root endpoint, returned by the adapter's
 *  `detect()` call. Used by V0.3.0 Step 5 to display the running
 *  version in the workspace header. The `major` / `minor` / `patch`
 *  fields are parsed once from `version` so downstream code does not
 *  have to re-parse on every comparison. */
export interface SearchEngineServerInfo {
  engineType: SearchEngineType
  engineName: string
  version: string
  major: number
  minor: number
  patch: number
  /** Distribution flavor reported by the server, e.g. "default" or
   *  "docker". Optional because not every engine emits one. */
  distribution?: string
  /** Human-readable supported-version range, e.g. "6.x-9.x". Filled
   *  by the adapter. */
  compatibleRange: string
}

/** Engine-agnostic index summary. Returned by `adapter.listIndices`.
 *  Adapters populate fields from whatever their engine reports; fields
 *  are nullable so partially-supported engines (e.g. engines without
 *  replica counts) can still satisfy the contract.
 *
 *  V0.3.0 Step 2 deliberately keeps this type separate from the
 *  pre-existing `EsIndexInfo` (which carries `docsDeleted`, `uuid`,
 *  numeric `storeSize` and an `index` field instead of `name`).
 *  Step 4's service refactor is responsible for the mapping between
 *  them. */
export interface SearchIndexInfo {
  name: string
  health?: string
  status?: string
  docsCount?: number
  storeSize?: string
  pri?: number
  rep?: number
}