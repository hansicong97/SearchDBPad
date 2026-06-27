/**
 * Shared IPC channel definitions.
 *
 * Keep channel names and payload/result types in one place so main and preload
 * stay in sync. Phase 2 introduces the connection management surface;
 * phase 3 adds cluster info and index listing; phase 4 adds per-index
 * mapping/settings; phase 5 adds document search; phase 7 adds
 * document create / update / delete.
 *
 * V0.3.0 adds generic search-engine type aliases (`EsConnection`,
 * `EsAuthType`) sourced from `shared/searchEngine`. The shape is
 * unchanged for now; this is purely a naming refactor that opens the
 * door for future engines (Solr / OpenSearch / …) to plug in without
 * another breaking IPC rewrite.
 */

import type {
  SearchAuthType,
  SearchConnection
} from './searchEngine'

/* ------------------------------------------------------------------ */
/* App-level channels (kept from phase 1 for future about/dialog use) */
/* ------------------------------------------------------------------ */

export const IpcChannels = {
  AppGetVersion: 'app:getVersion',
  AppGetPlatform: 'app:getPlatform',

  /* Connection management (phase 2) */
  ConnectionList: 'connection:list',
  ConnectionCreate: 'connection:create',
  ConnectionUpdate: 'connection:update',
  ConnectionDelete: 'connection:delete',
  ConnectionTest: 'connection:test',

  /* Connection folders (phase 15 UI update) */
  ConnectionFolderList: 'connection-folder:list',
  ConnectionFolderCreate: 'connection-folder:create',
  ConnectionFolderUpdate: 'connection-folder:update',
  ConnectionFolderDelete: 'connection-folder:delete',

  /* Cluster info and index list (phase 3) */
  ClusterInfo: 'cluster:info',
  ClusterHealth: 'cluster:health',
  IndexList: 'index:list',

  /* Index detail (phase 4) */
  IndexMapping: 'index:mapping',
  IndexSettings: 'index:settings',

  /* Index management (phase 13 version update) */
  IndexCreate: 'index:create',
  IndexDelete: 'index:delete',
  IndexClose: 'index:close',
  IndexOpen: 'index:open',
  IndexUpdateSettings: 'index:updateSettings',
  IndexUpdateMapping: 'index:updateMapping',

  /* Alias management (V0.3.4 A-4) */
  AliasList: 'alias:list',
  AliasAdd: 'alias:add',
  AliasDelete: 'alias:delete',

  /* Shard management (V0.3.9 E-7) */
  ShardList: 'shard:list',
  ShardRelocate: 'shard:relocate',
  ShardCancelAllocation: 'shard:cancelAllocation',

  /* Index templates (V0.3.4 A-5) */
  IndexTemplateList: 'index-template:list',
  IndexTemplateGet: 'index-template:get',
  IndexTemplateCreate: 'index-template:create',
  IndexTemplateDelete: 'index-template:delete',

  /* DSL favorites (V0.3.5 B-4) */
  DslFavoriteList: 'dsl-favorite:list',
  DslFavoriteCreate: 'dsl-favorite:create',
  DslFavoriteUpdate: 'dsl-favorite:update',
  DslFavoriteDelete: 'dsl-favorite:delete',

  /* Document search (phase 5) */
  DocumentSearch: 'document:search',

  /* Document CRUD (phase 7) */
  DocumentCreate: 'document:create',
  DocumentUpdate: 'document:update',
  DocumentDelete: 'document:delete',

  /* Document export (phase 8) */
  ExportExecute: 'export:execute',
  ExportPickSavePath: 'export:pickSavePath',

  /* Document import (phase 9) */
  ImportPickFile: 'import:pickFile',
  ImportPreview: 'import:preview',
  ImportExecute: 'import:execute',

  /* V0.3.7 B-3: long-running job progress events. The main process
   * uses `webContents.send` (not `ipcMain.handle`) to push these;
   * the renderer subscribes through `importDocs.onProgress` /
   * `exportDocs.onProgress`. */
  ImportProgressEvent: 'import:progress',
  ExportProgressEvent: 'export:progress',

  /* Search engine metadata (V0.3.0 §10.2) */
  SearchEngineDetect: 'search-engine:detect'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/* ------------------- App-level types (phase 1) ------------------- */

export interface AppVersionResult {
  version: string
  electron: string
  node: string
}

export interface AppPlatformResult {
  platform: NodeJS.Platform
  arch: string
}

/* ------------------- Connection types (phase 2) ------------------- */

/** Authentication type supported by an Elasticsearch endpoint. Aliased
 *  to `SearchAuthType` so future adapters can extend the union without
 *  touching this name. */
export type EsAuthType = SearchAuthType

/** A persisted Elasticsearch connection entry. Aliased to
 *  `SearchConnection`; the new `engineType` field is filled in by the
 *  connection service on every write and backfilled on read for
 *  pre-V0.3.0 entries. */
export type EsConnection = SearchConnection

/** Payload accepted by `connection:create` / `connection:update`. */
export interface EsConnectionInput {
  id?: string
  name: string
  url: string
  authType: EsAuthType
  username?: string
  password?: string
  folderId?: string | null
}

/** A user-defined folder for grouping connections in the sidebar.
 *  V0.3.9 E-4: folders may nest via `parentId`. `null` / `undefined`
 *  means top-level; any other value points at another folder's id.
 *  The renderer is responsible for refusing to set `parentId` to
 *  the folder's own id or any of its descendants (cycle check). */
export interface ConnectionFolder {
  id: string
  name: string
  /** V0.3.9 E-4: parent folder id for nesting. `null` / `undefined`
   *  means top-level. Older persisted folders without this field are
   *  backfilled to `null` on read. */
  parentId?: string | null
  createdAt: string
  updatedAt: string
}

/** Payload accepted by `connection-folder:create` / `:update`. */
export interface ConnectionFolderInput {
  id?: string
  name: string
  /** V0.3.9 E-4: optional parent folder id when creating a nested
   *  folder. Ignored on update to avoid silently moving folders —
   *  use the dedicated move API if/when it lands. */
  parentId?: string | null
}

/** Result of a `connection:test` call. */
export interface ConnectionTestResult {
  reachable: boolean
  clusterName?: string
  version?: string
  health?: 'green' | 'yellow' | 'red' | 'unknown'
  message?: string
}

/* ------------------- Cluster / index types (phase 3) ------------------- */

/** Single row from `GET /_cat/indices?format=json&bytes=b`. */
export interface EsIndexInfo {
  index: string
  health: 'green' | 'yellow' | 'red' | string
  status: 'open' | 'close' | string
  docsCount: number
  docsDeleted: number
  /** Store size in bytes. */
  storeSize: number
  pri: number
  rep: number
  uuid?: string
}

/** Result of `cluster:info` (root endpoint). */
export interface ClusterInfo {
  connectionId: string
  clusterName: string
  version: string
  /** ES distribution flavor, e.g. "default" or "docker". */
  distribution?: string
  /** Lucene version that backs the cluster. */
  luceneVersion?: string
}

/** Result of `cluster:health`. */
export interface ClusterHealth {
  connectionId: string
  status: 'green' | 'yellow' | 'red' | 'unknown'
  nodeCount: number
  activeShards?: number
  activePrimaryShards?: number
  unassignedShards?: number
}

/** Result of `index:list`. */
export interface IndexListResult {
  connectionId: string
  indices: EsIndexInfo[]
  indexCount: number
}

/** Common payload for cluster / index calls: just the connection to target. */
export interface ConnectionRef {
  connectionId: string
}

/* ------------------- Index detail types (phase 4) ------------------- */

/** Payload for `index:mapping` and `index:settings`. */
export interface IndexDetailRequest {
  connectionId: string
  index: string
}

/** Result of `index:mapping`. The `mapping` field is the raw JSON object
 *  returned by Elasticsearch, keyed by index name. */
export interface IndexMappingResult {
  connectionId: string
  index: string
  mapping: Record<string, unknown>
}

/** Result of `index:settings`. The `settings` field is the raw JSON object
 *  returned by Elasticsearch, keyed by index name. */
export interface IndexSettingsResult {
  connectionId: string
  index: string
  settings: Record<string, unknown>
}

/* ------------------- Index management types (phase 13) ------------------- */

/** Payload for `index:create`. Settings and mappings are optional:
 *  - both omitted → `PUT /{index}` creates an empty index with cluster
 *    defaults
 *  - settings only → body is `{ settings: {...} }`
 *  - mappings only → body is `{ mappings: {...} }`
 *  - both → body is `{ settings: {...}, mappings: {...} }` */
export interface IndexCreateRequest {
  connectionId: string
  index: string
  settings?: Record<string, unknown>
  mappings?: Record<string, unknown>
}

export interface IndexCreateResult {
  connectionId: string
  index: string
  acknowledged: boolean
}

/** Payload for `index:delete`. */
export interface IndexDeleteRequest {
  connectionId: string
  index: string
}

export interface IndexDeleteResult {
  connectionId: string
  index: string
  acknowledged: boolean
}

/* ------------------- Index lifecycle (V0.3.1 A-1) ------------------- */

/** Payload for `index:close` and `index:open`. Shares the
 *  `IndexDeleteRequest` shape — only the connection + target
 *  index are needed. */
export interface IndexLifecycleRequest {
  connectionId: string
  index: string
}

/** Ack-shaped result for `index:close` / `index:open`. Reuses the
 *  same fields as `IndexDeleteResult` so callers can use a single
 *  renderer-side branch for non-create index operations. */
export interface IndexLifecycleResult {
  connectionId: string
  index: string
  acknowledged: boolean
}

/* ------------------- Index settings update (V0.3.2 A-2) ------------------- */

/** Payload for `index:updateSettings`. `settings` is the raw object
 *  forwarded to `PUT /{index}/_settings` — typically `{
 *  index: { refresh_interval, number_of_replicas, ... } }`.
 *  Static settings (e.g. `number_of_shards`) will be rejected by
 *  Elasticsearch and surfaced as a server-side error. */
export interface IndexUpdateSettingsRequest {
  connectionId: string
  index: string
  settings: Record<string, unknown>
}

/** Ack-shaped result for `index:updateSettings`. */
export interface IndexUpdateSettingsResult {
  connectionId: string
  index: string
  acknowledged: boolean
}

/* ------------------- Index mapping update (V0.3.3 A-3) ------------------- */

/** Payload for `index:updateMapping`. Only field additions are
 *  supported in V0.3.3 — Elasticsearch rejects attempts to change
 *  the type of an existing field with `illegal_argument_exception`,
 *  which the renderer surfaces verbatim.
 *
 *  `mapping` is forwarded as the body of `PUT /{index}/_mapping`.
 *  For ES 6.x targets the adapter automatically wraps the body
 *  under `_doc` (see `versionCompat.ts`). */
export interface IndexUpdateMappingRequest {
  connectionId: string
  index: string
  mapping: Record<string, unknown>
}

/** Ack-shaped result for `index:updateMapping`. */
export interface IndexUpdateMappingResult {
  connectionId: string
  index: string
  acknowledged: boolean
}

/* ------------------- Alias management (V0.3.4 A-4) ------------------- */

/** A single alias attached to an index. The `index` field lets the
 *  renderer group by target when the payload comes from
 *  `GET /_alias` (which keys the response by index name). */
export interface EsAliasInfo {
  /** The alias name, e.g. "logs-current". */
  alias: string
  /** The concrete index this alias currently points at. */
  index: string
}

/** Result of `alias:list`. The renderer groups by `index` for the
 *  per-index tab view and flattens for any cross-index list. */
export interface AliasListResult {
  connectionId: string
  aliases: EsAliasInfo[]
}

/** Payload for `alias:add` and `alias:delete`. */
export interface AliasModifyRequest {
  connectionId: string
  index: string
  alias: string
}

export interface AliasModifyResult {
  connectionId: string
  index: string
  alias: string
  acknowledged: boolean
}

/* ------------------- Index templates (V0.3.4 A-5) ------------------- */

/** A single template row. `legacy` distinguishes the ES ≤ 7.7
 *  `/ _template` path from the ES 7.8+ `/_index_template` path so
 *  the renderer can label them accurately. */
export interface EsIndexTemplateInfo {
  name: string
  legacy: boolean
}

/** Result of `index-template:list`. */
export interface IndexTemplateListResult {
  connectionId: string
  templates: EsIndexTemplateInfo[]
}

/** Payload for `index-template:get`. */
export interface IndexTemplateGetRequest {
  connectionId: string
  name: string
}

/** Body of a single template. Returned by `index-template:get` as
 *  the raw object the engine stores; passed to
 *  `index-template:create` as the body the engine should accept.
 *  We expose it as `Record<string, unknown>` because the shape
 *  diverges between legacy (`{ index_patterns, settings, mappings }`)
 *  and composable (`{ index_patterns, template: { settings, mappings } }`). */
export interface IndexTemplateGetResult {
  connectionId: string
  name: string
  legacy: boolean
  template: Record<string, unknown>
}

/** Payload for `index-template:create`. */
export interface IndexTemplateCreateRequest {
  connectionId: string
  name: string
  /** If omitted, the adapter decides legacy vs composable based on
   *  the cached server version. The renderer can override for
   *  advanced use cases. */
  legacy?: boolean
  template: Record<string, unknown>
}

export interface IndexTemplateModifyResult {
  connectionId: string
  name: string
  acknowledged: boolean
}

/** Payload for `index-template:delete`. */
export interface IndexTemplateDeleteRequest {
  connectionId: string
  name: string
  /** If omitted, the adapter tries both endpoints and lets the
   *  server pick. */
  legacy?: boolean
}

/* ------------------- Document search types (phase 5) ------------------- */

/** Payload for `document:search`. The `query` body is forwarded verbatim
 *  to `POST /{index}/_search`, so the caller controls `from`, `size`,
 *  `query`, `sort`, `aggs`, etc. */
export interface DocumentSearchRequest {
  connectionId: string
  index: string
  query: Record<string, unknown>
}

/** A single hit as returned by Elasticsearch. */
export interface DocumentHit {
  _id: string
  _index: string
  _score: number | null
  _source: Record<string, unknown> | null
}

/** Result of `document:search`. The `raw` field carries the full ES
 *  response so the DSL tab can show a raw-response view. */
export interface DocumentSearchResult {
  connectionId: string
  index: string
  /** Wall-clock time Elasticsearch spent on the query, in milliseconds. */
  took: number
  /** Number of matched documents. Folded from `hits.total.value`. */
  total: number
  /** ES 7+ reports total as `{ value, relation }`. `eq` means exact,
   *  `gte` means the count was capped (track_total_hits). */
  totalRelation: 'eq' | 'gte'
  hits: DocumentHit[]
  /** The unparsed ES response, for the optional raw-response view. */
  raw: unknown
}

/* ------------------- Document CRUD types (phase 7) ------------------- */

/** Payload for `document:create` and `document:update`. The `id` is
 *  optional for create (omitted → `POST /{index}/_doc`, ES auto-generates
 *  one); required for update. */
export interface DocumentWriteRequest {
  connectionId: string
  index: string
  /** Required for update, optional for create. */
  id?: string
  /** The new `_source` body. */
  source: Record<string, unknown>
}

/** Result of `document:create` / `document:update`. */
export interface DocumentWriteResult {
  connectionId: string
  index: string
  id: string
  /** ES returns `created` for first-time writes and `updated` when the
   *  same `_id` already existed (PUT semantics on the same doc). */
  result: 'created' | 'updated'
  version: number
}

/** Payload for `document:delete`. */
export interface DocumentDeleteRequest {
  connectionId: string
  index: string
  id: string
}

/** Result of `document:delete`. */
export interface DocumentDeleteResult {
  connectionId: string
  index: string
  id: string
  result: 'deleted' | 'not_found'
  version: number
}

/* ------------------- Export types (phase 8) ------------------- */

export type ExportFormat = 'json' | 'ndjson' | 'csv'

/** Payload for `export:execute`. The main process opens the save dialog,
 *  resolves `outputPath`, fetches up to `maxRows` docs from `index` (using
 *  `match_all` if `query` is omitted), converts them to the chosen
 *  format, writes the file, and returns the path + row count. */
export interface ExportRequest {
  connectionId: string
  index: string
  format: ExportFormat
  outputPath: string
  /** Hard cap is enforced server-side at 10000 (ES `index.max_result_window`
   *  default). The renderer is expected to clamp the user input. */
  maxRows: number
  /** Optional DSL body. Omitted → `match_all`. */
  query?: Record<string, unknown>
}

/** Hard cap on exported rows. Matches ES default `index.max_result_window`,
 *  so a single `_search` with `size: MAX_EXPORT_ROWS` works without
 *  raising the cluster setting. */
export const MAX_EXPORT_ROWS = 10000

/** Result of `export:execute`. */
export interface ExportResult {
  /** V0.3.7 B-3: job id used to correlate the result with the
   *  progress events the main process pushed while the export
   *  was running. The renderer uses it to drop late events that
   *  arrive after the user already started a new job. */
  jobId: string
  connectionId: string
  index: string
  format: ExportFormat
  outputPath: string
  rows: number
  bytes: number
}

/** Payload for `export:pickSavePath`. Opens the OS save dialog and
 *  returns the chosen path (or `null` if the user cancelled). */
export interface ExportPickPathRequest {
  index: string
  format: ExportFormat
}

export interface ExportPickPathResult {
  outputPath: string | null
}

/* ------------------- Import types (phase 9 + 13) ------------------- */

/** Format of the source file. `auto` is only accepted by
 *  `import:preview` / `import:execute`; `import:pickFile` returns the
 *  inferred (non-`auto`) format. */
export type ImportFormat = 'auto' | 'json' | 'ndjson' | 'csv'

/** How to write the imported rows to the target index.
 *  - `append`  → keep existing docs, write the new ones (may overwrite
 *    same-_id docs).
 *  - `replace` → first run `POST /{index}/_delete_by_query` to wipe
 *    existing docs, then write the new ones. The mapping / settings
 *    of the index are preserved. */
export type ImportMode = 'append' | 'replace'

/** Payload for `import:pickFile`. Opens the OS open dialog and returns
 *  the chosen file path plus the format inferred from the extension.
 *  The hint is what the renderer expects (e.g. preferred filter);
 *  the returned format is the resolved one and is never `'auto'`. */
export interface ImportPickFileRequest {
  /** Pre-select filter — caller passes the format the user expects. */
  format: Exclude<ImportFormat, 'auto'>
}

export interface ImportPickFileResult {
  filePath: string | null
  /** Format inferred from the file extension. The renderer may override
   *  this if the user picks a different format. Never `'auto'`. */
  format: Exclude<ImportFormat, 'auto'> | null
}

/** Payload for `import:preview`. Parses up to `maxRows` rows from the
 *  file and returns the rows + an estimated total + a list of warnings
 *  (e.g. "looks like NDJSON but extension is .json"). The renderer uses
 *  this to populate the preview table. */
export interface ImportPreviewRequest {
  filePath: string
  format: ImportFormat
  maxRows: number
}

export interface ImportPreviewRow {
  /** Optional — only present when the source row carries an `_id`
   *  (JSON array with `_id` keys, NDJSON Bulk format). */
  id?: string
  /** The `_source`-equivalent body. Always present. */
  source: Record<string, unknown>
  /** Original raw text for the row, for failure reporting. */
  raw?: string
}

export interface ImportPreviewResult {
  format: ImportFormat
  /** Estimated total number of rows in the file. For NDJSON / CSV this
   *  is the line count; for JSON arrays this is `array.length`. The
   *  count is "estimated" because the parser does not need to fully
   *  materialize every row to compute it. */
  totalRows: number
  rows: ImportPreviewRow[]
  warnings: string[]
}

/** Payload for `import:execute`. The main process parses the file, sends
 *  `client.bulk` calls in batches of `BULK_BATCH_SIZE`, and returns the
 *  aggregated result. `mode=replace` triggers a
 *  `POST /{index}/_delete_by_query` before the bulk; the index itself
 *  is not dropped. `format='auto'` is resolved from the file extension
 *  on the main side. */
export interface ImportExecuteRequest {
  connectionId: string
  index: string
  filePath: string
  format: ImportFormat
  mode: ImportMode
}

export interface ImportFailure {
  /** 0-based row index in the source file. */
  line: number
  /** Optional `_id` from the row, if known. */
  id?: string
  /** ES error reason from the Bulk response. */
  error: string
  /** Original raw text, truncated to 500 chars for display. */
  raw?: string
}

export interface ImportExecuteResult {
  /** V0.3.7 B-3: job id used to correlate the result with the
   *  progress events the main process pushed while the import
   *  was running. */
  jobId: string
  connectionId: string
  index: string
  format: ImportFormat
  total: number
  success: number
  failed: number
  /** First N failures (capped server-side at e.g. 20). */
  failures: ImportFailure[]
}

/* ------------------- Job progress (V0.3.7 B-3) ------------------- */

/** Coarse stage a long-running import job is currently in. The
 *  renderer uses these for the human-readable label and the icon
 *  shown next to the progress bar. */
export type ImportStage =
  | 'reading' /* reading the source file from disk */
  | 'parsing' /* parsing rows out of the file (JSON / NDJSON / CSV) */
  | 'clearing' /* `_delete_by_query` (replace mode only) */
  | 'writing' /* `POST /_bulk` batches */
  | 'completed' /* job finished successfully */
  | 'failed' /* job aborted with an error */

/** A single progress update for an import job. Pushed from the
 *  main process to the renderer over the `import:progress` channel.
 *  The renderer filters by `jobId` so out-of-order or stale events
 *  from a previous job are dropped.
 *
 *  Field invariants:
 *   - `stage` is the current stage; `completed` / `failed` carry a
 *     final `message`.
 *   - `percent` is 0..100 once `total` is known, `null` otherwise
 *     (e.g. during `reading` we don't yet know how many rows the
 *     file contains).
 *   - `total` is null until parsing finishes; for `writing` it is
 *     the row count the parser produced.
 *   - `processed` mirrors `total` once writing finishes a batch.
 *   - `success` / `failed` are cumulative counters across batches. */
export interface ImportProgress {
  jobId: string
  stage: ImportStage
  percent: number | null
  total: number | null
  processed: number | null
  success: number
  failed: number
  /** Only set on `completed` / `failed`. */
  message?: string
}

export type ExportStage =
  | 'querying' /* `POST /{index}/_search` to fetch hits */
  | 'writing' /* serialize + write to disk */
  | 'completed'
  | 'failed'

/** A single progress update for an export job. Pushed from the main
 *  process to the renderer over the `export:progress` channel.
 *  Same jobId-scoped filtering rules as `ImportProgress`. */
export interface ExportProgress {
  jobId: string
  stage: ExportStage
  percent: number | null
  /** Docs fetched so far. null until querying finishes. */
  total: number | null
  /** Bytes written so far. null until writing starts. */
  bytes: number | null
  message?: string
}

/* ------------------- DSL favorites (V0.3.5 B-4) ------------------- */

/** A persisted favorite DSL query. `dsl` is stored as a raw JSON
 *  string so the renderer can re-parse it with the same formatting
 *  the user originally typed; we don't try to canonicalize the
 *  object. `indexName` is a free-form label — the favorite itself
 *  is global and can be applied to any index the user picks at
 *  load time. An empty string means "no specific index". */
export interface DslFavorite {
  id: string
  name: string
  indexName: string
  dsl: string
  createdAt: string
  updatedAt: string
}

/** Payload for `dsl-favorite:create` and `dsl-favorite:update`.
 *  `id` is required for update, omitted for create. The service
 *  layer validates `name` and the JSON content of `dsl` — invalid
 *  input surfaces as a 4xx-shaped error envelope rather than a
 *  half-written record. */
export interface DslFavoriteInput {
  id?: string
  name: string
  indexName: string
  dsl: string
}

/* ------------------- Shard management types (V0.3.9 E-7) ------------------- */

/** Single shard row from `GET /_cat/shards/{index}?format=json&bytes=b`.
 *  Field names mirror what `_cat/shards` reports — they are taken
 *  verbatim so the renderer can label columns the same way ES does. */
export interface ShardInfo {
  /** Shard index (0-based). */
  shard: string
  /** Either "p" for primary or "r" for replica. */
  prirep: 'p' | 'r' | string
  /** Current shard state, e.g. STARTED / UNASSIGNED / RELOCATING /
   *  INITIALIZING. Other values are passed through unchanged. */
  state: string
  /** Number of docs in the shard. */
  docs: string
  /** Store size of the shard, as a human-readable string from ES. */
  store: string
  /** IP of the node that hosts the shard; empty when UNASSIGNED. */
  ip: string
  /** Node name (or empty when UNASSIGNED). */
  node: string
  /** Unassigned reason for UNASSIGNED shards, otherwise empty. */
  unassignedReason?: string
  /** Current allocation id (newer ES versions only). */
  completionPercent?: string
}

export interface ShardListResult {
  connectionId: string
  index: string
  shards: ShardInfo[]
}

/** Payload for `shard:relocate`. Uses a `move` reroute command —
 *  `fromNode` and `toNode` are required; `index` + `shard` identify
 *  the shard being moved. The renderer is expected to fill in all
 *  four fields. */
export interface ShardRelocateRequest {
  connectionId: string
  index: string
  shard: string
  fromNode: string
  toNode: string
}

/** Payload for `shard:cancelAllocation`. Uses a `cancel` reroute
 *  command on a shard that is currently unassigned (replica that
 *  has not been allocated yet). */
export interface ShardCancelRequest {
  connectionId: string
  index: string
  shard: string
  node: string
  /** When `true`, allow the primary shard to be cancelled (cancels
   *  the primary shard from being allocated in case of a
   *  reassignment). Defaults to false to match ES' default. */
  allowPrimary?: boolean
}

/** Result of `shard:relocate` and `shard:cancelAllocation`. ES
 *  always returns `acknowledged: true` on a successful reroute. */
export interface ShardRerouteResult {
  connectionId: string
  index: string
  shard: string
  acknowledged: boolean
}

/* ------------------- Generic response envelope ------------------- */

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    message: string
    detail?: unknown
  }
}
