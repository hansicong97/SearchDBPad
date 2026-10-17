/**
 * Search Engine Adapter interface.
 *
 * The base contract is the minimum every adapter must satisfy. The
 * business service layer (`src/main/services/*.service.ts`) talks
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
  IndexMaintenanceResult,
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
import type { SearchEngineManifest, SearchEngineCapabilities, SearchResourceInfo, SearchQueryInput, SearchQueryResult, SearchSchemaResult, CommitPolicy, SearchQueryLanguage } from '../../shared/searchEngine'
import { SearchEngineError } from './errors'

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
// strings here. File IO + format parsing live in the service layer; the
// adapter only sees pre-parsed rows (import) or pure numeric knobs (export).

export type DocumentSearchInput = Omit<
  DocumentSearchRequest,
  'connectionId'
> & { signal?: AbortSignal }

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
  signal?: AbortSignal
  commitPolicy?: CommitPolicy
  index: string
  rows: ImportRow[]
  mode: ImportMode
  /** V0.3.11 G-1: cooperative cancellation checkpoint. Adapters call
   *  this between safe units of work; they do not abort in-flight
   *  network requests. */
  isCancelled?: () => boolean
  /** V0.3.7 B-3: optional batch-level progress callback. The
   *  adapter invokes this after each `_bulk` batch with the
   *  cumulative success / failed counts. The service layer wraps
   *  this in a `jobId`-tagged `ImportProgress` event for the
   *  renderer. Adapters that do not support progress reporting
   *  may safely ignore this field. */
  onBatchProgress?: (info: { success: number; failed: number }) => void
}

export interface ExportInput {
  signal?: AbortSignal
  queryLanguage?: SearchQueryLanguage
  index: string
  /** Caller-clamped upper bound on how many hits to return. */
  maxRows: number
  query?: Record<string, unknown>
  /** V0.3.11 G-2: cooperative cancellation checkpoint. */
  isCancelled?: () => boolean
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
  /**
   * Whether a replace import has performed its destructive clear. Adapters
   * that validate rows before clearing may return false and keep the service
   * in replace mode for the next batch. Omitting the marker preserves the
   * legacy contract where the first adapter call owns replacement.
   */
  replaceApplied?: boolean
}

/** Engine-native shape for the export result. The service formats +
 *  writes the hits; the adapter does no file IO. */
export interface ExportResult {
  index: string
  hits: DocumentHit[]
  total: number
}

/* ----------------------------- Adapter ----------------------------- */

export interface BaseSearchEngineAdapter {
  manifest: SearchEngineManifest
  getCapabilities(connection?: SearchConnection): SearchEngineCapabilities | Promise<SearchEngineCapabilities>
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
}

export interface ResourceCatalogCapability {
  listResources(connection: SearchConnection): Promise<SearchResourceInfo[]>
}
export interface SchemaCapability {
  getSchema(connection: SearchConnection, resourceName: string): Promise<SearchSchemaResult>
}
export interface DocumentQueryCapability {
  queryDocuments(connection: SearchConnection, input: SearchQueryInput): Promise<SearchQueryResult>
}
export interface IndexManagementCapability {

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
}
export interface DocumentWriteCapability {

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
}
export interface IndexLifecycleCapability {

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

}
export interface IndexMaintenanceCapability {

  /** `POST /{index}/_refresh`，使最近写入对搜索可见。 */
  refreshIndex(
    connection: SearchConnection,
    indexName: string
  ): Promise<IndexMaintenanceResult>

  /** `POST /{index}/_flush`，将内存 buffer 持久化到磁盘。 */
  flushIndex(
    connection: SearchConnection,
    indexName: string
  ): Promise<IndexMaintenanceResult>

  /** `POST /{index}/_forcemerge`。`maxNumSegments` 为正整数时作为
   *  `max_num_segments` 查询参数；省略则由引擎自行决定。 */
  forceMergeIndex(
    connection: SearchConnection,
    indexName: string,
    maxNumSegments?: number
  ): Promise<IndexMaintenanceResult>

  /** `POST /{index}/_cache/clear`，清除索引级 cache。 */
  clearIndexCache(
    connection: SearchConnection,
    indexName: string
  ): Promise<IndexMaintenanceResult>

}
export interface AliasCapability {

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

}
export interface TemplateCapability {

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

}
export interface BulkTransferCapability {
  exportBatches(connection: SearchConnection, input: ExportInput): AsyncIterable<DocumentHit[]>
  importDocuments(
    connection: SearchConnection,
    input: ImportInput
  ): Promise<ImportResult>

  exportDocuments(
    connection: SearchConnection,
    input: ExportInput
  ): Promise<ExportResult>

}
export interface ShardCapability {

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

export interface TaskCapability {
  executeTask(connection: SearchConnection, input: Omit<import('../../shared/ipc').EngineTaskRequest, 'connectionId'>): Promise<import('../../shared/ipc').EngineTaskResult>
  getTask(connection: SearchConnection, taskId: string): Promise<import('../../shared/ipc').EngineTaskResult>
  cancelTask(connection: SearchConnection, taskId: string): Promise<import('../../shared/ipc').EngineTaskResult>
}
export type AdapterOperations = ResourceCatalogCapability & SchemaCapability & DocumentQueryCapability & DocumentWriteCapability & IndexManagementCapability & IndexLifecycleCapability & IndexMaintenanceCapability & AliasCapability & TemplateCapability & BulkTransferCapability & ShardCapability & TaskCapability
export type SearchEngineAdapter = BaseSearchEngineAdapter & Partial<AdapterOperations>

type CapabilityName = Exclude<keyof SearchEngineCapabilities, 'versionFeatures'>

/**
 * Runtime capability gates for adapter methods. The registry validates that a
 * declared `true` capability has the corresponding method, but that check is
 * intentionally only an initialization check. Adapters can report narrower
 * capabilities after detecting a particular server version, so every service
 * invocation must check the resolved connection capabilities as well.
 *
 * Keep this map engine-neutral: it describes product operations and the
 * capability that authorizes them, never an engine endpoint or URL shape.
 */
const operationCapabilities: Record<keyof AdapterOperations, CapabilityName[]> = {
  listResources: ['resourceCatalog'],
  getSchema: ['schema'],
  queryDocuments: ['documentQuery'],
  searchDocuments: ['documentQuery'],
  getClusterInfo: ['indexManagement'],
  getClusterHealth: ['indexManagement'],
  listIndices: ['resourceCatalog', 'indices'],
  getIndexMapping: ['schema', 'mappings'],
  getIndexSettings: ['indexManagement', 'settings'],
  createDocument: ['documentWrite'],
  updateDocument: ['documentWrite'],
  deleteDocument: ['documentWrite'],
  createIndex: ['indexManagement', 'indices'],
  deleteIndex: ['indexManagement', 'indices'],
  closeIndex: ['indexManagement', 'openCloseIndex'],
  openIndex: ['indexManagement', 'openCloseIndex'],
  updateIndexSettings: ['indexManagement', 'settings'],
  updateIndexMapping: ['indexManagement', 'mappings'],
  refreshIndex: ['indexManagement', 'maintenance'],
  flushIndex: ['indexManagement', 'maintenance'],
  forceMergeIndex: ['indexManagement', 'maintenance'],
  clearIndexCache: ['indexManagement', 'maintenance'],
  listAliases: ['indexManagement', 'aliases'],
  addAlias: ['indexManagement', 'aliases'],
  deleteAlias: ['indexManagement', 'aliases'],
  listIndexTemplates: ['indexManagement', 'indexTemplates'],
  getIndexTemplate: ['indexManagement', 'indexTemplates'],
  createIndexTemplate: ['indexManagement', 'indexTemplates'],
  deleteIndexTemplate: ['indexManagement', 'indexTemplates'],
  importDocuments: ['bulkTransfer', 'importExport'],
  exportDocuments: ['bulkTransfer', 'importExport'],
  exportBatches: ['bulkTransfer', 'importExport'],
  listIndexShards: ['indexManagement', 'shardManagement'],
  relocateShard: ['indexManagement', 'shardManagement'],
  cancelShardAllocation: ['indexManagement', 'shardManagement'],
  executeTask: ['tasks'],
  getTask: ['tasks'],
  cancelTask: ['tasks']
}

function unsupported(adapter: SearchEngineAdapter, operation: keyof AdapterOperations): SearchEngineError {
  return new SearchEngineError({
    engineType: adapter.type,
    code: 'unsupported_capability',
    message: adapter.displayName + ' 不支持此操作: ' + operation
  })
}

async function assertOperationCapability(
  adapter: SearchEngineAdapter,
  operation: keyof AdapterOperations,
  connection: SearchConnection,
  input: unknown
): Promise<void> {
  // Production adapters implement the base method. Keeping a manifest
  // fallback makes legacy in-process test doubles safe while still enforcing
  // every capability they explicitly declare.
  const declaredCapabilities = adapter.manifest?.capabilities as SearchEngineCapabilities | undefined
  const capabilities = typeof adapter.getCapabilities === 'function'
    ? await adapter.getCapabilities(connection)
    : declaredCapabilities
  if (!capabilities) return
  const required = operationCapabilities[operation]
  // Task operation names are product-level capabilities too. A server may
  // expose task polling while disabling reindex or query mutation.
  if (operation === 'executeTask' && input && typeof input === 'object') {
    const taskOperation = (input as { operation?: unknown }).operation
    if (taskOperation === 'reindex' && capabilities.reindex !== true) throw unsupported(adapter, operation)
    if ((taskOperation === 'updateByQuery' || taskOperation === 'deleteByQuery') && capabilities.queryMutation !== true) {
      throw unsupported(adapter, operation)
    }
  }
  if (required.some(capability => capabilities[capability] !== true)) throw unsupported(adapter, operation)
}

/** Resolve an optional operation explicitly; no engine must supply fake stubs.
 * The returned function performs the capability check immediately before the
 * underlying call, so version-derived capability changes cannot be bypassed
 * by services that already hold a method reference. */
export function requireOperation<K extends keyof AdapterOperations>(adapter: SearchEngineAdapter, operation: K): AdapterOperations[K] {
  const method = adapter[operation]
  if (typeof method !== 'function') throw unsupported(adapter, operation)
  // Preserve streaming and backpressure: exportBatches returns an iterable,
  // while every other operation in the contract returns a Promise.
  if (operation === 'exportBatches') {
    return (async function* (...args: [SearchConnection, ExportInput]) {
      await assertOperationCapability(adapter, operation, args[0], args[1])
      yield* Reflect.apply(method, adapter, args) as AsyncIterable<DocumentHit[]>
    }) as unknown as AdapterOperations[K]
  }
  return (async (...args: unknown[]) => {
    const connection = args[0] as SearchConnection
    await assertOperationCapability(adapter, operation, connection, args[1])
    return Reflect.apply(method, adapter, args)
  }) as AdapterOperations[K]
}
