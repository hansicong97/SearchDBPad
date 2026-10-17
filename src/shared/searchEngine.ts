/**
 * Generic search engine types.
 *
 * This file holds the engine-neutral types shared between main, preload,
 * and renderer. Versioned manifests and capabilities keep engine-specific
 * behavior out of the shared renderer contract.
 *
 * Engine-specific quirks (URL shape, version differences, request
 * signing, etc.) MUST stay inside `src/main/adapters/<engine>/` and
 * never leak into `src/shared/`.
 */

/** Supported search engine types. Add a new literal here when a new
 *  adapter lands, then wire it through `src/main/search/adapterRegistry.ts`.
 *  V0.4.0 ships built-in Elasticsearch, OpenSearch and Solr adapters. */
export type SearchEngineType = 'elasticsearch' | 'opensearch' | 'solr'

/** Authentication schemes understood by the built-in HTTP adapters.
 *  Each manifest declares the schemes its adapter accepts. */
export type SearchAuthType = 'none' | 'basic'

/** Stable capability identifiers shared by adapters and the renderer.
 *  Capabilities describe product operations, not engine endpoints. */
export interface SearchEngineCapabilities {
  resourceCatalog: boolean
  documentQuery: boolean
  documentWrite: boolean
  schema: boolean
  indexManagement: boolean
  bulkTransfer: boolean
  tasks: boolean

  /** Detail flags used by the current Elasticsearch UI. Keeping these
   *  explicit lets a future engine expose only the controls it supports. */
  indices: boolean
  mappings: boolean
  settings: boolean
  aliases: boolean
  indexTemplates: boolean
  dslQuery: boolean
  simpleQuery: boolean
  importExport: boolean
  openCloseIndex: boolean
  shardManagement: boolean
  maintenance: boolean
  deepPagination: boolean
  reindex: boolean
  queryMutation: boolean

  /** Adapter-specific feature flags derived from the detected server version. */
  versionFeatures?: Record<string, boolean>
}

export const emptySearchEngineCapabilities = (): SearchEngineCapabilities => ({
  resourceCatalog: false,
  documentQuery: false,
  documentWrite: false,
  schema: false,
  indexManagement: false,
  bulkTransfer: false,
  tasks: false,
  indices: false,
  mappings: false,
  settings: false,
  aliases: false,
  indexTemplates: false,
  dslQuery: false,
  simpleQuery: false,
  importExport: false,
  openCloseIndex: false,
  shardManagement: false,
  maintenance: false,
  deepPagination: false,
  reindex: false,
  queryMutation: false
})

/** Versioned metadata exposed by the main process. Adapter-specific HTTP
 *  details must stay out of this structure. */
export interface SearchEngineManifest {
  type: SearchEngineType
  displayName: string
  description?: string
  protocolFamily: string
  supportedVersions: string[]
  authSchemes: SearchAuthType[]
  resourceModel: 'index' | 'collection' | 'mixed'
  capabilities: SearchEngineCapabilities
  manifestVersion: 1
  adapterVersion: string
  queryLanguages: SearchQueryLanguage[]
  transferFormats: Array<'json' | 'csv' | 'ndjson'>
}

/** A persisted connection to a search engine. The deprecated
 *  `EsConnection` alias remains available for source compatibility, while
 *  new IPC and renderer code should use this engine-neutral name.
 *
 *  Entries persisted before `engineType` existed are backfilled to
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
 *  `detect()` call. The `major` / `minor` / `patch`
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
 *  This type stays separate from the compatibility `EsIndexInfo` shape
 *  (which carries `docsDeleted`, `uuid`,
 *  numeric `storeSize` and an `index` field instead of `name`).
 *  Step 4's service refactor is responsible for the mapping between
 *  them.
 *
 *  V0.3.1 C-2: `docsDeleted` and `uuid` are restored on the adapter
 *  shape so engines that report them (Elasticsearch) flow the real
 *  values through without lossy fallbacks. Other adapters may leave
 *  them undefined. */
export interface SearchIndexInfo {
  name: string
  health?: string
  status?: string
  docsCount?: number
  /** Number of deleted documents, as reported by engines that track
   *  tombstones (Elasticsearch). Optional because not every engine
   *  exposes this metric. */
  docsDeleted?: number
  /** Engine-native identifier for the index instance. For
   *  Elasticsearch this is the value of the `uuid` column from
   *  `/_cat/indices`. Optional because not every engine emits one. */
  uuid?: string
  storeSize?: string
  pri?: number
  rep?: number
}

/** Engine-neutral resource summary. Elasticsearch's index type remains
 *  available for compatibility with the existing UI. */
export interface SearchResourceInfo {
  name: string
  kind: 'index' | 'collection' | 'core' | 'resource'
  status?: string
  health?: string
  documentCount?: number
  metadata?: Record<string, unknown>
}

/** Generic document representation used by adapters and the shared UI.
 *  Engine-native response data can be retained in `raw`. */
export interface SearchDocumentHit {
  id?: string
  fields: Record<string, unknown>
  sortValues?: unknown[]
  raw?: unknown
}

export type SearchQueryLanguage = 'elasticsearch-dsl' | 'solr'
export type CommitPolicy = 'auto' | 'commit' | 'softCommit' | 'none'

/** AbortSignal stays inside the main process and never crosses IPC. */
export interface SearchRequestContext {
  connectionId: string
  resourceName?: string
  requestSeq: number
  signal?: AbortSignal
}
export interface SearchQueryInput {
  resourceName: string
  queryLanguage: SearchQueryLanguage
  query: Record<string, unknown>
  requestSeq?: number
  signal?: AbortSignal
}
export interface SearchQueryResult {
  connectionId: string
  resourceName: string
  requestSeq?: number
  took: number
  total: number
  totalRelation: 'eq' | 'gte'
  hits: SearchDocumentHit[]
  raw?: unknown
}
export interface SearchSchemaResult {
  connectionId: string
  resourceName: string
  fields: Array<{ name: string; type?: string; multiValued?: boolean; required?: boolean; stored?: boolean; metadata?: Record<string, unknown> }>
  uniqueKey?: string
  raw?: unknown
}
