/**
 * Search Engine Adapter interface.
 *
 * V0.3.0 §5.1: this is the single contract every adapter must satisfy.
 *  The business service layer (`src/main/services/*.service.ts`) talks
 *  to adapters only through this interface — it never imports a
 *  concrete `src/main/adapters/<engine>/*` file.
 *
 * Design rules baked into the interface:
 *  1. Method names describe product capabilities, not engine APIs
 *     (e.g. `searchDocuments`, never `esSearch`).
 *  2. Inputs are engine-agnostic. The adapter translates to whatever
 *     shape its engine needs (URL paths, header flags, NDJSON bodies).
 *  3. Outputs reuse the public types in `shared/ipc.ts` whenever
 *     possible so the renderer / preload do not need to know which
 *     adapter is active.
 *  4. Unsupported capabilities throw `SearchEngineError` with code
 *     `'unsupported_capability'` rather than silently degrading.
 *
 * The registry that resolves adapters lives in `./adapterRegistry.ts`.
 */

import type {
  AliasListResult,
  AliasModifyResult,
  ClusterHealth,
  ClusterInfo,
  ConnectionTestResult,
  DocumentDeleteRequest,
  DocumentDeleteResult,
  DocumentHit,
  DocumentSearchRequest,
  DocumentSearchResult,
  DocumentWriteRequest,
  DocumentWriteResult,
  ImportFailure,
  ImportMode,
  IndexCreateRequest,
  IndexCreateResult,
  IndexDeleteResult,
  IndexTemplateGetResult,
  IndexTemplateListResult,
  IndexTemplateModifyResult,
  ShardInfo,
  ShardRerouteResult
} from '../../shared/ipc'
import type {
  SearchConnection,
  SearchEngineServerInfo,
  SearchIndexInfo
} from '../../shared/searchEngine'

/** Re-export the IPC result / data types that concrete adapters need
 *  to satisfy `SearchEngineAdapter`. Keeps adapter files from importing
 *  `shared/ipc.ts` directly — the adapter layer's only shared surface
 *  stays `adapter.types.ts`. */
export type {
  DocumentDeleteResult,
  DocumentHit,
  DocumentSearchResult,
  DocumentWriteResult,
  ImportFailure
} from '../../shared/ipc'

/* ------------------------------ Inputs ------------------------------ */
// Inputs are the public IPC payload minus `connectionId` — the adapter
// receives the resolved `connection` as a separate parameter so it can
// pull URL / auth out of it without re-asking the service layer.
//
// Import / Export deliberately do NOT carry file paths or format
// strings here. Per V0.3.0 §9.5, file IO + format parsing live in the
// service layer; the adapter only sees pre-parsed rows (import) or
// pure numeric knobs (export).

export type DocumentSearchInput = Omit<
  DocumentSearchRequest,
  'connectionId'
>

export type DocumentCreateInput = Omit<
  DocumentWriteRequest,
  'connectionId'
>

/** Identical to `DocumentCreateInput` except `id` is required.
 *  Derivation strips the optional `id` from the create input and
 *  re-adds it as a mandatory string. */
export type DocumentUpdateInput = Omit<
  DocumentCreateInput,
  'id'
> & {
  id: string
}

export type DocumentDeleteInput = Omit<
  DocumentDeleteRequest,
  'connectionId'
>

export type CreateIndexInput = Omit<IndexCreateRequest, 'connectionId'>

/** A single row handed to the adapter by the import service after it
 *  has read + parsed the user's file. */
export interface ImportRow {
  id?: string
  source: Record<string, unknown>
}

export interface ImportInput {
  index: string
  rows: ImportRow[]
  mode: ImportMode
  /** V0.3.7 B-3: optional batch-level progress callback. The
   *  adapter invokes this after each `_bulk` batch with the
   *  cumulative success / failed counts. The service layer wraps
   *  this in a `jobId`-tagged `ImportProgress` event for the
   *  renderer. Adapters that do not support progress reporting
   *  may safely ignore this field. */
  onBatchProgress?: (info: { success: number; failed: number }) => void
}

export interface ExportInput {
  index: string
  /** Caller-clamped upper bound on how many hits to return. */
  maxRows: number
  query?: Record<string, unknown>
}

/* ----------------------------- Outputs ----------------------------- */
// Output shapes reuse the public IPC types where the caller already
//  expects an envelope (e.g. ClusterInfo carries `connectionId`). The
//  shorter names below are aliases so the adapter signature reads
//  engine-agnostically (`CreateIndexResult` rather than
//  `IndexCreateResult`) while the renderer-facing types in
//  `shared/ipc.ts` keep their existing names.

export type CreateIndexResult = IndexCreateResult
export type DeleteIndexResult = IndexDeleteResult

/** Engine-native shape for the import result. The service layer adds
 *  `connectionId` + `format` and forwards to the renderer. */
export interface ImportResult {
  index: string
  total: number
  success: number
  failed: number
  failures: ImportFailure[]
}

/** Engine-native shape for the export result. The service formats +
 *  writes the hits; the adapter does no file IO. */
export interface ExportResult {
  index: string
  hits: DocumentHit[]
  total: number
}

/* ----------------------------- Adapter ----------------------------- */

export interface SearchEngineAdapter {
  /** Stable identifier — matches `SearchConnection.engineType`. */
  type: SearchConnection['engineType']
  /** Human-readable name for UI labels, e.g. "Elasticsearch". */
  displayName: string

  /** Probe the engine's identity (GET /) and return parsed version
   *  metadata. Cheap, but does issue a network round trip — the
   *  service layer is expected to cache the result via
   *  `serverVersionCache.ts`. */
  detect(connection: SearchConnection): Promise<SearchEngineServerInfo>

  /** Lightweight reachability probe (1–2 requests). Should never
   *  throw for non-network errors: surface them as `reachable: false`
   *  with a human-readable `message` instead. */
  testConnection(connection: SearchConnection): Promise<ConnectionTestResult>

  getClusterInfo(connection: SearchConnection): Promise<ClusterInfo>

  getClusterHealth(connection: SearchConnection): Promise<ClusterHealth>

  listIndices(connection: SearchConnection): Promise<SearchIndexInfo[]>

  /** Return the raw mapping JSON as reported by the engine. Kept as
   *  `unknown` because mapping shapes vary wildly between versions. */
  getIndexMapping(
    connection: SearchConnection,
    indexName: string
  ): Promise<unknown>

  getIndexSettings(
    connection: SearchConnection,
    indexName: string
  ): Promise<unknown>

  searchDocuments(
    connection: SearchConnection,
    input: DocumentSearchInput
  ): Promise<DocumentSearchResult>

  createDocument(
    connection: SearchConnection,
    input: DocumentCreateInput
  ): Promise<DocumentWriteResult>

  updateDocument(
    connection: SearchConnection,
    input: DocumentUpdateInput
  ): Promise<DocumentWriteResult>

  deleteDocument(
    connection: SearchConnection,
    input: DocumentDeleteInput
  ): Promise<DocumentDeleteResult>

  createIndex(
    connection: SearchConnection,
    input: CreateIndexInput
  ): Promise<CreateIndexResult>

  deleteIndex(
    connection: SearchConnection,
    indexName: string
  ): Promise<DeleteIndexResult>

  /** V0.3.1 A-1: close an open index so it stops accepting reads
   *  / writes but keeps its data on disk. Returns an ack-shape result
   *  that mirrors `DeleteIndexResult` so callers can reuse error
   *  reporting. Adapters that don't support close should throw
   *  `SearchEngineError('unsupported_capability')`. */
  closeIndex(
    connection: SearchConnection,
    indexName: string
  ): Promise<DeleteIndexResult>

  /** V0.3.1 A-1: re-open a previously closed index. Same error
   *  contract as `closeIndex`. */
  openIndex(
    connection: SearchConnection,
    indexName: string
  ): Promise<DeleteIndexResult>

  /** V0.3.2 A-2: update the live settings of an index via
   *  `PUT /{index}/_settings`. The `settings` object is forwarded
   *  as-is — typically `{ index: { refresh_interval, ... } }`.
   *  Engines reject static settings (e.g. `number_of_shards`); the
   *  error message should be surfaced to the caller verbatim so the
   *  UI can show it without re-parsing. */
  updateIndexSettings(
    connection: SearchConnection,
    indexName: string,
    settings: Record<string, unknown>
  ): Promise<DeleteIndexResult>

  /** V0.3.3 A-3: append fields to an existing index mapping via
   *  `PUT /{index}/_mapping`. The `mapping` object is forwarded as
   *  the request body — typically `{ properties: { ... } }`. The
   *  adapter is responsible for ES 6.x `_doc` wrapping if needed
   *  (see `versionCompat.ts`).
   *  Elasticsearch rejects any attempt to change the type of an
   *  existing field; the renderer surfaces that error verbatim. */
  updateIndexMapping(
    connection: SearchConnection,
    indexName: string,
    mapping: Record<string, unknown>
  ): Promise<DeleteIndexResult>

  /* ----------- V0.3.4 A-4: alias management ----------- */

  listAliases(connection: SearchConnection): Promise<AliasListResult>

  addAlias(
    connection: SearchConnection,
    indexName: string,
    aliasName: string
  ): Promise<AliasModifyResult>

  deleteAlias(
    connection: SearchConnection,
    indexName: string,
    aliasName: string
  ): Promise<AliasModifyResult>

  /* ----------- V0.3.4 A-5: index templates ----------- */

  listIndexTemplates(
    connection: SearchConnection
  ): Promise<IndexTemplateListResult>

  getIndexTemplate(
    connection: SearchConnection,
    name: string
  ): Promise<IndexTemplateGetResult>

  createIndexTemplate(
    connection: SearchConnection,
    name: string,
    template: Record<string, unknown>,
    legacy?: boolean
  ): Promise<IndexTemplateModifyResult>

  deleteIndexTemplate(
    connection: SearchConnection,
    name: string,
    legacy?: boolean
  ): Promise<IndexTemplateModifyResult>

  importDocuments(
    connection: SearchConnection,
    input: ImportInput
  ): Promise<ImportResult>

  exportDocuments(
    connection: SearchConnection,
    input: ExportInput
  ): Promise<ExportResult>

  /* ----------- V0.3.9 E-7: shard management ----------- */

  /** Read the shard table for a single index. Returns one row per
   *  shard (primary + each replica). Pure read; safe to call on
   *  every refresh. */
  listIndexShards(
    connection: SearchConnection,
    indexName: string
  ): Promise<ShardInfo[]>

  /** Relocate a started shard from `fromNode` to `toNode` via
   *  `POST /_cluster/reroute` with a `move` command. ES rejects
   *  unknown node names with a 400 — the service layer surfaces
   *  that verbatim. */
  relocateShard(
    connection: SearchConnection,
    indexName: string,
    shard: string,
    fromNode: string,
    toNode: string
  ): Promise<ShardRerouteResult>

  /** Cancel the allocation of an unassigned shard via
   *  `POST /_cluster/reroute` with a `cancel` command. `allowPrimary`
   *  is forwarded to ES' `allow_primary` flag; defaults to false to
   *  match ES' own default. */
  cancelShardAllocation(
    connection: SearchConnection,
    indexName: string,
    shard: string,
    node: string,
    allowPrimary?: boolean
  ): Promise<ShardRerouteResult>
}