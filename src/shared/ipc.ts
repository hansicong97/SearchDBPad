/**
 * Shared IPC channel definitions.
 *
 * Keep channel names and payload/result types in one place so main and preload
 * stay in sync. Phase 2 introduces the connection management surface;
 * phase 3 adds cluster info and index listing; phase 4 adds per-index
 * mapping/settings; phase 5 adds document search; phase 7 adds
 * document create / update / delete.
 */

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
  ImportExecute: 'import:execute'
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

/** Authentication type supported by an Elasticsearch endpoint. */
export type EsAuthType = 'none' | 'basic'

/** A persisted Elasticsearch connection entry. */
export interface EsConnection {
  id: string
  name: string
  url: string
  authType: EsAuthType
  username?: string
  password?: string
  createdAt: string
  updatedAt: string
}

/** Payload accepted by `connection:create` / `connection:update`. */
export interface EsConnectionInput {
  id?: string
  name: string
  url: string
  authType: EsAuthType
  username?: string
  password?: string
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
  connectionId: string
  index: string
  format: ImportFormat
  total: number
  success: number
  failed: number
  /** First N failures (capped server-side at e.g. 20). */
  failures: ImportFailure[]
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
