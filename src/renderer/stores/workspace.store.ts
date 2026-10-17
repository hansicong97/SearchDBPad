/**
 * Renderer-side workspace state (phase 3 + 4 + 5 + 6 + 7).
 *
 * Holds:
 *  - the active connection id
 *  - cluster info + health fetched for the active connection
 *  - the list of indices
 *  - per-resource loading / error flags
 *  - the currently selected index (phase 4)
 *  - the selected index's mapping and settings (phase 4)
 *  - the selected index's document browse state (phase 5)
 *  - the selected index's DSL query state (phase 5)
 *  - the selected index's simple-query state (phase 6)
 *
 * Phase 7 adds create / update / delete actions. CRUD errors are not
 * persisted in the store — they are surfaced inline in the editor
 * modal and via a one-shot toast.
 *
 * V0.3.6 B-2: DSL queries are no longer a single (results, loading,
 * error) triple — they live in a list of tabs, each with its own
 * state. The active tab's id is tracked separately so we can
 * look it up in O(1). The list is reset on connection / index
 * change so the query area stays scoped to the current view.
 *
 * The store does not know how to talk to Elasticsearch directly — it only
 * goes through `window.searchApi.cluster.*`, `window.searchApi.indices.*` and
 * `window.searchApi.documents.*`. The main process is the only place that
 * touches the network.
 */

import { create } from 'zustand'
import { useConnectionStore } from './connection.store'
import type {
  ApiResponse,
  ClusterHealth,
  ClusterInfo,
  DocumentDeleteRequest,
  DocumentDeleteResult,
  DocumentHit,
  DocumentSearchResult,
  DocumentWriteRequest,
  DocumentWriteResult,
  DslFavorite,
  DslFavoriteInput,
  ImportExecuteRequest,
  ImportExecuteResult,
  IndexCreateRequest,
  IndexCreateResult,
  IndexDeleteRequest,
  IndexDeleteResult,
  IndexLifecycleRequest,
  IndexLifecycleResult,
  IndexTemplateCreateRequest,
  IndexTemplateDeleteRequest,
  IndexTemplateGetRequest,
  IndexTemplateGetResult,
  IndexTemplateListResult,
  IndexTemplateModifyResult,
  IndexUpdateMappingRequest,
  IndexUpdateMappingResult,
  IndexUpdateSettingsRequest,
  IndexUpdateSettingsResult,
  AliasListResult,
  AliasModifyRequest,
  AliasModifyResult,
  EsAliasInfo,
  ShardCancelRequest,
  ShardInfo,
  ShardRelocateRequest,
  ShardRerouteResult
} from '@shared/ipc'
import type {
  SearchEngineCapabilities,
  SearchEngineServerInfo,
  SearchQueryLanguage,
  SearchQueryResult,
  SearchResourceInfo
} from '@shared/searchEngine'

/** V0.3.10 F-3: tab key the workspace can ask the detail
 *  panel to land on. We include `documents` (the default) and
 *  `import` (the create-and-import landing tab). The detail
 *  panel itself supports more tabs but those are chosen by the
 *  user inside the panel, not by a cross-flow jump. */
export type IndexDetailTabKey = 'documents' | 'import'

/** Default page size for the document browse tab. */
const DEFAULT_PAGE_SIZE = 20

/** Default DSL body for a freshly created tab. `match_all` + a small
 *  page size is the most common starting point for an interactive
 *  query — users refine from there. */
const DEFAULT_DSL_BODY = '{\n  "query": {\n    "match_all": {}\n  },\n  "size": 20\n}'

/** Query request sequence numbers are renderer-local and only need to be
 * monotonic for stale-response protection. The main process echoes the
 * number in SearchQueryResult, which also makes it available for future
 * cancellation / progress flows. */
let nextQueryRequestSeq = 0

/**
 * The renderer cannot pass an AbortSignal through Electron IPC.  Query
 * cancellation therefore uses the request identity that the main process
 * registers (`connectionId + resourceName + requestSeq`).  Keep the active
 * identities outside Zustand so replacing a request can cancel the previous
 * one before the state update is committed.
 */
interface PendingSearchQuery {
  connectionId: string
  resourceName: string
  requestSeq: number
}

let pendingDocumentQuery: PendingSearchQuery | null = null
let pendingSimpleQuery: PendingSearchQuery | null = null
const pendingDslQueries = new Map<string, PendingSearchQuery>()

function cancelSearchQuery(query: PendingSearchQuery | null): void {
  if (!query) return
  const cancel = globalThis.window?.searchApi?.searchEngine?.cancel
  if (typeof cancel !== 'function') return
  void Promise.resolve(cancel(query)).catch(() => undefined)
}

function cancelAllPendingSearchQueries(): void {
  cancelSearchQuery(pendingDocumentQuery)
  cancelSearchQuery(pendingSimpleQuery)
  for (const query of pendingDslQueries.values()) cancelSearchQuery(query)
  pendingDocumentQuery = null
  pendingSimpleQuery = null
  pendingDslQueries.clear()
}

function cancelPendingDslQuery(id: string): void {
  cancelSearchQuery(pendingDslQueries.get(id) ?? null)
  pendingDslQueries.delete(id)
}

function responseMatchesQuery(
  response: ApiResponse<SearchQueryResult>,
  query: PendingSearchQuery
): boolean {
  if (!response.success || !response.data) return true
  const data = response.data
  return (
    data.connectionId === query.connectionId &&
    data.resourceName === query.resourceName &&
    data.requestSeq === query.requestSeq
  )
}

function allocateQueryRequestSeq(): number {
  nextQueryRequestSeq += 1
  return nextQueryRequestSeq
}

function queryLanguageForConnection(connectionId: string): SearchQueryLanguage {
  return useConnectionStore.getState().connections.find((connection) => connection.id === connectionId)?.engineType === 'solr'
    ? 'solr'
    : 'elasticsearch-dsl'
}

function toDocumentSearchResponse(
  response: ApiResponse<SearchQueryResult>
): ApiResponse<DocumentSearchResult> {
  if (!response.success || !response.data) {
    return {
      success: false,
      error: response.error
    }
  }
  const result = response.data
  return {
    success: true,
    data: {
      connectionId: result.connectionId,
      index: result.resourceName,
      took: result.took,
      total: result.total,
      totalRelation: result.totalRelation,
      hits: result.hits,
      raw: result.raw ?? result
    }
  }
}

/** V0.3.6 B-2: per-tab DSL query state. Each tab carries its own
 *  title, target index, editor content, last results, and
 *  loading / error flag. Storing these per tab (rather than in a
 *  single results/loading/error triple) is what makes "switch
 *  tab and don't lose the draft" possible. */
export interface DslTab {
  id: string
  title: string
  /** Target index for `_search`. Captured at tab creation; the
   *  user can edit it per tab so different tabs can target
   *  different indices in parallel. */
  indexName: string
  /** Editor content. Persists across tab switches without
   *  re-fetching. */
  dsl: string
  results: DocumentSearchResult | null
  loading: boolean
  error: string | null
}

interface WorkspaceState {
  activeConnectionId: string | null

  clusterInfo: ClusterInfo | null
  clusterHealth: ClusterHealth | null
  clusterLoading: boolean
  clusterError: string | null
  clusterRequestSeq: number

  /** Legacy state name retained while the catalog uses resource:list. */
  indices: SearchResourceInfo[]
  indexCount: number
  indicesLoading: boolean
  indicesError: string | null
  indicesRequestSeq: number

  /* Phase 4: index detail */
  selectedIndex: string | null
  mapping: Record<string, unknown> | null
  mappingLoading: boolean
  mappingError: string | null
  mappingRequestSeq: number
  settings: Record<string, unknown> | null
  settingsLoading: boolean
  settingsError: string | null
  settingsRequestSeq: number

  /* Phase 5: document browse tab */
  documentHits: DocumentHit[]
  documentTotal: number
  documentTotalRelation: 'eq' | 'gte'
  documentTook: number
  documentPage: number /* 1-based */
  documentPageSize: number
  documentLoading: boolean
  documentError: string | null
  documentRequestSeq: number

  /* V0.4.0: engine capabilities for the active connection. */
  capabilities: SearchEngineCapabilities | null
  capabilitiesLoading: boolean
  capabilitiesError: string | null
  capabilitiesRequestSeq: number

  /* Phase 6: simple query tab */
  simpleResults: DocumentSearchResult | null
  simpleLoading: boolean
  simpleError: string | null
  simpleRequestSeq: number

  /* V0.3.0 §10.2: search engine version probe. Cached per-connection
   * in the main process; the renderer only holds the latest result
   * for the active connection so the workspace header can show it. */
  serverInfo: SearchEngineServerInfo | null
  serverInfoLoading: boolean
  serverInfoError: string | null
  serverInfoRequestSeq: number

  /* V0.3.4 A-4 + A-5: alias + template cross-tab state. Aliases
   * are scoped to a single connection (the active one); templates
   * are also scoped to a single connection. Both are kept in
   * store so the workspace header / IndexDetailPanel can render
   * directly off them without each panel triggering its own fetch. */
  aliases: EsAliasInfo[]
  aliasesLoading: boolean
  aliasesError: string | null
  aliasesRequestSeq: number

  templates: IndexTemplateListResult['templates']
  templatesLoading: boolean
  templatesError: string | null
  templatesRequestSeq: number

  /* V0.3.9 E-7: shard table for the selected index. Cached per-index
   * via the standard race-guard pattern (drop the result if the user
   * navigated to another index mid-flight). */
  shards: ShardInfo[]
  shardsLoading: boolean
  shardsError: string | null
  shardsRequestSeq: number

  /* V0.3.5 B-4: DSL favorites are persisted in the main process
   * via electron-store (same mechanism as connections). They are
   * global — not scoped to a single connection or index — and
   * survive application restarts. The DslFavoriteModal reads
   * directly off this state, so the workspace store can fetch
   * once per session and the modal renders synchronously. */
  dslFavorites: DslFavorite[]
  dslFavoritesLoading: boolean
  dslFavoritesError: string | null

  /* V0.3.6 B-2: DSL query tabs. The list holds every tab; the
   * active id is the one currently shown in the editor. The
   * list is reset on connection / index change so a query
   *  drafted against one index does not silently run against
   *  another after the user navigates away. */
  dslTabs: DslTab[]
  activeDslTabId: string | null
  dslRequestSeq: Record<string, number>

  /* V0.3.10 F-3: one-shot "open this index and land on a specific
   * tab" intent. The IndexDetailPanel consumes the value the first
   * time it mounts for the target index and then clears it, so the
   * user can keep navigating between tabs after the jump without
   * being pulled back to the original one. The list of allowed
   * tabs is intentionally narrow: it is a navigation hint, not a
   * free-form user setting. */
  pendingIndexDetailTab: IndexDetailTabKey | null

  setActiveConnection: (id: string | null) => void

  fetchCluster: (connectionId: string) => Promise<void>
  fetchIndices: (connectionId: string) => Promise<void>
  fetchServerInfo: (connectionId: string) => Promise<void>
  fetchCapabilities: (connectionId: string) => Promise<void>
  refreshAll: () => Promise<void>

  selectIndex: (name: string | null) => void
  /* V0.3.10 F-3: open `name` and ask the detail panel to land on
   * `tab`. No-op if `name` is null. The previous `importDraft`
   * argument was removed in the F-3 revised flow: ImportPanel is
   * always the entry point for picking the import file. */
  selectIndexWithTab: (
    name: string,
    tab: IndexDetailTabKey
  ) => void
  /* V0.3.10 F-3: clear the pending tab after the panel has
   * consumed it. Safe to call when nothing is pending. */
  clearPendingIndexDetailIntent: () => void
  fetchMapping: (connectionId: string, index: string) => Promise<void>
  fetchSettings: (connectionId: string, index: string) => Promise<void>
  refreshIndexDetail: () => Promise<void>

  /* Phase 5 actions */
  setDocumentPage: (page: number) => void
  setDocumentPageSize: (size: number) => void
  fetchDocumentPage: (
    connectionId: string,
    index: string,
    page: number,
    pageSize: number
  ) => Promise<void>
  refreshDocumentPage: () => Promise<void>

  /* V0.3.6 B-2: DSL query tab actions. Each action is scoped to
   * a specific tab id so the active tab and the tab the user
   * kicked off the request on are not conflated. The list is
   * reset on connection / index change. */

  /** Internal helper to patch one tab. Stored on the state so
   *  the per-action `set` callbacks can use it without a
   *  closure capture. Not part of the public surface. */
  _patchTab: (tabs: DslTab[], id: string, patch: Partial<DslTab>) => DslTab[]

  /** Create a new tab and switch to it. Returns the new tab's id
   *  so the caller can use it as a controlled value if needed. */
  addDslTab: (opts?: { indexName?: string; title?: string }) => string
  /** Close a tab. If the closed tab was active, switch to the
   *  adjacent one (next by default, previous at the end). */
  closeDslTab: (id: string) => void
  /** Switch the active tab. No-op if the id is unknown. */
  selectDslTab: (id: string) => void
  /** Rename a tab. Empty / whitespace names are rejected (the
   *  tab is left untouched and the function returns false). */
  renameDslTab: (id: string, title: string) => boolean
  /** Update the editor content of a tab. Called per keystroke
   *  from the Monaco editor; we don't re-parse or run anything
   *  here, just store. */
  updateDslTabContent: (id: string, dsl: string) => void
  /** Update the target index of a tab. The next query on this
   *  tab will run against the new index. */
  setDslTabIndex: (id: string, indexName: string) => void
  /** Run the query for a specific tab. The result / error /
   *  loading flag are written to that tab only. Returns the
   *  IPC envelope (or `null` if the tab was closed mid-call). */
  runDslTabQuery: (
    id: string
  ) => Promise<ApiResponse<DocumentSearchResult> | null>
  /** Clear the results / error of a tab (the editor content is
   *  preserved). */
  clearDslTab: (id: string) => void

  /* Phase 6 actions */
  runSimpleQuery: (
    connectionId: string,
    index: string,
    body: Record<string, unknown>,
    queryLanguage?: SearchQueryLanguage
  ) => Promise<ApiResponse<DocumentSearchResult> | null>

  /* Phase 7 actions: document CRUD. Each action returns the IPC
   * envelope (or `null` if the selected index changed mid-call) and,
   * on success, refreshes the current document browse page so the
   * table reflects the change without the caller having to do it. */
  createDocument: (
    req: DocumentWriteRequest
  ) => Promise<ApiResponse<DocumentWriteResult> | null>
  updateDocument: (
    req: DocumentWriteRequest
  ) => Promise<ApiResponse<DocumentWriteResult> | null>
  deleteDocument: (
    req: DocumentDeleteRequest
  ) => Promise<ApiResponse<DocumentDeleteResult> | null>

  /* Phase 13 actions: index create / delete. On success the index
   * list is re-fetched so the new / removed index shows up. The
   * `onCreated` / `onDeleted` callbacks live in the call sites
   * (IndexList / CreateIndexModal). */
  createIndex: (
    req: IndexCreateRequest
  ) => Promise<ApiResponse<IndexCreateResult> | null>
  deleteIndex: (
    req: IndexDeleteRequest
  ) => Promise<ApiResponse<IndexDeleteResult> | null>

  /* V0.3.1 A-1: close / open lifecycle. Same refresh-on-success
   * shape as deleteIndex; if the toggled index was the one being
   * viewed, the detail view is left alone — the user can still see
   * the closing status until they navigate away or reopen it. */
  closeIndex: (
    req: IndexLifecycleRequest
  ) => Promise<ApiResponse<IndexLifecycleResult> | null>
  openIndex: (
    req: IndexLifecycleRequest
  ) => Promise<ApiResponse<IndexLifecycleResult> | null>

  /* V0.3.2 A-2: dynamic-settings update. On success, the cached
   * `settings` payload for the active index is re-fetched so the
   * Settings tab reflects the new value without a manual refresh. */
  updateIndexSettings: (
    req: IndexUpdateSettingsRequest
  ) => Promise<ApiResponse<IndexUpdateSettingsResult> | null>

  /* V0.3.3 A-3: append-fields mapping update. On success the cached
   * `mapping` payload is re-fetched so the Mapping tab reflects
   * the new fields without a manual refresh. */
  updateIndexMapping: (
    req: IndexUpdateMappingRequest
  ) => Promise<ApiResponse<IndexUpdateMappingResult> | null>

  /* V0.3.4 A-4: alias list scoped to the currently active
   * connection. Stores a flat list and the same loading/error
   * scaffolding as the rest of the workspace tabs so the Alias
   * panel can render directly off the store. */
  fetchAliases: (connectionId: string) => Promise<void>
  addAlias: (
    req: AliasModifyRequest
  ) => Promise<ApiResponse<AliasModifyResult> | null>
  deleteAlias: (
    req: AliasModifyRequest
  ) => Promise<ApiResponse<AliasModifyResult> | null>

  /* V0.3.4 A-5: index template list and a currently-inspected
   * template body. Loading + error flags live alongside the list so
   * the Template panel reuses the same scaffolding as the other
   * workspace tabs. */
  fetchTemplates: (connectionId: string) => Promise<void>
  inspectTemplate: (
    req: IndexTemplateGetRequest
  ) => Promise<ApiResponse<IndexTemplateGetResult> | null>
  createTemplate: (
    req: IndexTemplateCreateRequest
  ) => Promise<ApiResponse<IndexTemplateModifyResult> | null>
  deleteTemplate: (
    req: IndexTemplateDeleteRequest
  ) => Promise<ApiResponse<IndexTemplateModifyResult> | null>

  /* V0.3.9 E-7: shard actions. `fetchShards` loads the per-shard
   * table; `relocateShard` and `cancelShardAllocation` execute
   * write operations and refresh the table on success. */
  fetchShards: (connectionId: string, index: string) => Promise<void>
  relocateShard: (
    req: ShardRelocateRequest
  ) => Promise<ApiResponse<ShardRerouteResult> | null>
  cancelShardAllocation: (
    req: ShardCancelRequest
  ) => Promise<ApiResponse<ShardRerouteResult> | null>

  /* V0.3.5 B-4: DSL favorite list + CRUD. The list is fetched
   * once at app start (not on connection change) because
   * favorites are global. The modal handles its own refresh on
   * open. */
  fetchDslFavorites: () => Promise<void>
  createDslFavorite: (
    input: DslFavoriteInput
  ) => Promise<ApiResponse<DslFavorite> | null>
  updateDslFavorite: (
    input: DslFavoriteInput
  ) => Promise<ApiResponse<DslFavorite> | null>
  deleteDslFavorite: (
    id: string
  ) => Promise<ApiResponse<{ id: string }> | null>

  /* Phase 13: import via IPC. Used by ImportPanel and by
   * CreateIndexModal for the "create-and-import" flow. On success the
   * current document browse page is refreshed if it is the same
   * index, so the new docs show up without a manual reload. */
  runImport: (
    req: ImportExecuteRequest
  ) => Promise<ApiResponse<ImportExecuteResult> | null>

  clear: () => void
}

function readError<T>(res: ApiResponse<T>, fallback: string): string {
  return res.error?.message ?? fallback
}

/** Electron can reject invoke() when a sender or transport is unavailable.
 * Keep that failure inside the normal UI error state without echoing secrets. */
async function workspaceRequest<T>(operation: () => Promise<ApiResponse<T>>): Promise<ApiResponse<T>> {
  try { return await operation() }
  catch { return { success: false, error: { message: '请求失败，请重试' } } }
}

/** Default DSL body for the document browse tab. match_all + page size. */
function defaultBrowseBody(
  page: number,
  pageSize: number
): Record<string, unknown> {
  return {
    query: { match_all: {} },
    from: (page - 1) * pageSize,
    size: pageSize
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeConnectionId: null,

  clusterInfo: null,
  clusterHealth: null,
  clusterLoading: false,
  clusterError: null,
  clusterRequestSeq: 0,

  indices: [],
  indexCount: 0,
  indicesLoading: false,
  indicesError: null,
  indicesRequestSeq: 0,

  selectedIndex: null,
  mapping: null,
  mappingLoading: false,
  mappingError: null,
  mappingRequestSeq: 0,
  settings: null,
  settingsLoading: false,
  settingsError: null,
  settingsRequestSeq: 0,

  documentHits: [],
  documentTotal: 0,
  documentTotalRelation: 'eq',
  documentTook: 0,
  documentPage: 1,
  documentPageSize: DEFAULT_PAGE_SIZE,
  documentLoading: false,
  documentError: null,
  documentRequestSeq: 0,

  capabilities: null,
  capabilitiesLoading: false,
  capabilitiesError: null,
  capabilitiesRequestSeq: 0,

  /* V0.3.6 B-2: DSL query tabs. The list is empty by default; the
   * DslQueryPanel will auto-create a default tab the first time it
   * mounts for a selected index. */
  dslTabs: [] as DslTab[],
  activeDslTabId: null as string | null,
  dslRequestSeq: {} as Record<string, number>,

  simpleResults: null,
  simpleLoading: false,
  simpleError: null,
  simpleRequestSeq: 0,

  serverInfo: null,
  serverInfoLoading: false,
  serverInfoError: null,
  serverInfoRequestSeq: 0,

  aliases: [],
  aliasesLoading: false,
  aliasesError: null,
  aliasesRequestSeq: 0,

  templates: [],
  templatesLoading: false,
  templatesError: null,
  templatesRequestSeq: 0,

  // V0.3.9 E-7: shard table is per-index; the panel that owns
  // it (ShardPanel) triggers `fetchShards` on first mount.
  shards: [],
  shardsLoading: false,
  shardsError: null,
  shardsRequestSeq: 0,

  dslFavorites: [],
  dslFavoritesLoading: false,
  dslFavoritesError: null,

  /* V0.3.10 F-3 / F-4: one-shot intent that asks the detail panel
   * to land on a specific tab (and optionally hand off an import
   * draft to ImportPanel) when the user navigates from elsewhere
   * in the app — most notably the create-and-import flow. */
  pendingIndexDetailTab: null as IndexDetailTabKey | null,

  setActiveConnection: (id) => {
    if (id === get().activeConnectionId) return
    cancelAllPendingSearchQueries()
    set({
      activeConnectionId: id,
      clusterLoading: false,
      clusterRequestSeq: allocateQueryRequestSeq(),
      serverInfoRequestSeq: allocateQueryRequestSeq(),
      mappingRequestSeq: allocateQueryRequestSeq(),
      settingsRequestSeq: allocateQueryRequestSeq(),
      aliasesRequestSeq: allocateQueryRequestSeq(),
      templatesRequestSeq: allocateQueryRequestSeq(),
      shardsRequestSeq: allocateQueryRequestSeq(),
      // Clear previous connection's data so the UI doesn't briefly show
      // stale cluster info for the wrong connection.
      clusterInfo: null,
      clusterHealth: null,
      clusterError: null,
      indices: [],
      indexCount: 0,
      indicesLoading: false,
      indicesError: null,
      indicesRequestSeq: allocateQueryRequestSeq(),
      // Phase 4: also clear the detail view state.
      selectedIndex: null,
      mapping: null,
      mappingError: null,
      mappingLoading: false,
      settings: null,
      settingsError: null,
      settingsLoading: false,
      // Phase 5: also clear the document / DSL state.
      documentHits: [],
      documentTotal: 0,
      documentTotalRelation: 'eq',
      documentTook: 0,
      documentPage: 1,
      documentPageSize: DEFAULT_PAGE_SIZE,
      documentLoading: false,
      documentError: null,
      documentRequestSeq: allocateQueryRequestSeq(),
      capabilities: null,
      capabilitiesLoading: false,
      capabilitiesError: null,
      capabilitiesRequestSeq: allocateQueryRequestSeq(),
      // V0.3.6 B-2: reset DSL tabs on connection change so a
      // query drafted against one cluster's index doesn't
      // silently run against a different cluster's index.
      dslTabs: [],
      activeDslTabId: null,
      dslRequestSeq: {},
      // Phase 6: also clear the simple-query state.
      simpleResults: null,
      simpleLoading: false,
      simpleError: null,
      simpleRequestSeq: allocateQueryRequestSeq(),
      // V0.3.0 §10.2: clear the engine probe result so the header
      // badge doesn't briefly show the previous connection's version.
      serverInfo: null,
      serverInfoLoading: false,
      serverInfoError: null,
      // V0.3.4 A-4 + A-5: clear alias / template state so the
      // workspace header doesn't briefly show stale entries from a
      // different connection.
      aliases: [],
      aliasesLoading: false,
      aliasesError: null,
      templates: [],
      templatesLoading: false,
      templatesError: null,
      // V0.3.9 E-7: clear shard table when switching connections
      // so the next panel mount fetches fresh data.
      shards: [],
      shardsLoading: false,
      shardsError: null
    })
    if (id) {
      void get().fetchCluster(id)
      void get().fetchIndices(id)
      void get().fetchServerInfo(id)
      void get().fetchCapabilities(id)
      // V0.3.4 A-4 + A-5: aliases and templates are both
      // connection-scoped, so they get fetched up front on
      // connection change rather than lazily on tab open.
      void get().fetchAliases(id)
      void get().fetchTemplates(id)
    }
  },

  fetchCluster: async (connectionId) => {
    if (get().activeConnectionId !== connectionId) return
    const requestSeq = allocateQueryRequestSeq()
    set({ clusterLoading: true, clusterError: null, clusterRequestSeq: requestSeq })
    const [infoRes, healthRes] = await Promise.all([
      workspaceRequest(() => window.searchApi.cluster.info({ connectionId })),
      workspaceRequest(() => window.searchApi.cluster.health({ connectionId }))
    ])
    if (get().activeConnectionId !== connectionId || get().clusterRequestSeq !== requestSeq) return
    const infoOk = infoRes.success
    const healthOk = healthRes.success
    set({
      clusterLoading: false,
      clusterInfo: infoOk ? (infoRes.data ?? null) : get().clusterInfo,
      clusterHealth: healthOk ? (healthRes.data ?? null) : get().clusterHealth,
      clusterError:
        !infoOk || !healthOk
          ? readError(
              (infoOk ? healthRes : infoRes) as ApiResponse<unknown>,
              '获取集群信息失败'
            )
          : null
    })
  },

  fetchIndices: async (connectionId) => {
    if (get().activeConnectionId !== connectionId) return
    const requestSeq = allocateQueryRequestSeq()
    set({ indicesLoading: true, indicesError: null, indicesRequestSeq: requestSeq })
    const res = await workspaceRequest(() => window.searchApi.searchEngine.resources(connectionId))
    if (
      get().activeConnectionId !== connectionId ||
      get().indicesRequestSeq !== requestSeq
    ) return
    // A transport/mock can resolve with a response for an earlier
    // connection while the active connection has already changed. Keep the
    // request context check at the response boundary as well as the local
    // sequence guard so same-named resources cannot cross connection scopes.
    if (res.success && res.data?.connectionId !== connectionId) return
    if (res.success && res.data) {
      set({
        indicesLoading: false,
        indices: [...res.data.resources].sort((a, b) => a.name.localeCompare(b.name)),
        indexCount: res.data.resourceCount,
        indicesError: null
      })
    } else {
      set({
        indicesLoading: false,
        indicesError: res.error?.message ?? '获取资源列表失败'
      })
    }
  },

  refreshAll: async () => {
    const id = get().activeConnectionId
    if (!id) return
    await Promise.all([
      get().fetchCluster(id),
      get().fetchIndices(id),
      get().fetchServerInfo(id),
      get().fetchCapabilities(id)
    ])
  },

  fetchServerInfo: async (connectionId) => {
    if (get().activeConnectionId !== connectionId) return
    const requestSeq = allocateQueryRequestSeq()
    set({ serverInfoLoading: true, serverInfoError: null, serverInfoRequestSeq: requestSeq })
    const res = await workspaceRequest(() => window.searchApi.searchEngine.detect(connectionId))
    if (get().activeConnectionId !== connectionId || get().serverInfoRequestSeq !== requestSeq) return
    if (res.success && res.data) {
      set({
        serverInfoLoading: false,
        serverInfo: res.data,
        serverInfoError: null
      })
    } else {
      set({
        serverInfoLoading: false,
        serverInfoError: res.error?.message ?? '探测搜索引擎版本失败'
      })
    }
  },

  fetchCapabilities: async (connectionId) => {
    if (get().activeConnectionId !== connectionId) return
    const requestSeq = allocateQueryRequestSeq()
    set({ capabilitiesLoading: true, capabilitiesError: null, capabilitiesRequestSeq: requestSeq })
    const res = await workspaceRequest(() => window.searchApi.searchEngine.capabilities(connectionId))
    if (get().activeConnectionId !== connectionId || get().capabilitiesRequestSeq !== requestSeq) return
    set({
      capabilitiesLoading: false,
      capabilities: res.success && res.data ? res.data.capabilities : null,
      capabilitiesError: res.success && res.data ? null : res.error?.message ?? '获取引擎能力失败'
    })
  },

  selectIndex: (name) => {
    if (name === null) {
      cancelAllPendingSearchQueries()
      set({
        selectedIndex: null,
        mappingLoading: false,
        settingsLoading: false,
        mappingRequestSeq: allocateQueryRequestSeq(),
        settingsRequestSeq: allocateQueryRequestSeq(),
        shardsRequestSeq: allocateQueryRequestSeq(),
        shards: [],
        shardsLoading: false,
        shardsError: null,
        mapping: null,
        mappingError: null,
        settings: null,
        settingsError: null,
        documentHits: [],
        documentTotal: 0,
        documentTotalRelation: 'eq',
        documentTook: 0,
        documentPage: 1,
        documentPageSize: DEFAULT_PAGE_SIZE,
        documentLoading: false,
        documentError: null,
        documentRequestSeq: allocateQueryRequestSeq(),
        // V0.3.6 B-2: dropping the index selection clears the
        // tab list — the next time the user picks an index, the
        // query panel will start with a fresh default tab.
        dslTabs: [],
        activeDslTabId: null,
        dslRequestSeq: {},
        simpleResults: null,
        simpleLoading: false,
        simpleError: null,
        simpleRequestSeq: allocateQueryRequestSeq()
      })
      return
    }
    if (name === get().selectedIndex) return
    cancelAllPendingSearchQueries()
    const id = get().activeConnectionId
    set({
      selectedIndex: name,
      mappingLoading: false,
      settingsLoading: false,
      mappingRequestSeq: allocateQueryRequestSeq(),
      settingsRequestSeq: allocateQueryRequestSeq(),
      shardsRequestSeq: allocateQueryRequestSeq(),
      mapping: null,
      mappingError: null,
      settings: null,
      settingsError: null,
      documentHits: [],
      documentTotal: 0,
      documentTotalRelation: 'eq',
      documentTook: 0,
      documentPage: 1,
      documentPageSize: DEFAULT_PAGE_SIZE,
      documentLoading: false,
      documentError: null,
      documentRequestSeq: allocateQueryRequestSeq(),
      // V0.3.6 B-2: reset tabs on every index change. A query
      // drafted against one index shouldn't bleed into the next
      // selection. The DslQueryPanel will auto-create a default
      // tab on its first mount for the new index.
      dslTabs: [],
      activeDslTabId: null,
      dslRequestSeq: {},
      simpleResults: null,
      simpleLoading: false,
      simpleError: null,
      simpleRequestSeq: allocateQueryRequestSeq(),
      // V0.3.9 E-7: clear shard table when switching indices;
      // ShardPanel triggers its own refresh on mount.
      shards: [],
      shardsLoading: false,
      shardsError: null
    })
    if (id) {
      void get().fetchMapping(id, name)
      void get().fetchSettings(id, name)
      void get().fetchDocumentPage(id, name, 1, DEFAULT_PAGE_SIZE)
    }
  },

  /* V0.3.10 F-3 / F-4: navigate to `name` AND record a one-shot
   * intent for the detail panel. The intent is cleared by the
   * panel once it has applied it (see `IndexDetailPanel`). When
   * `importDraft` is provided, ImportPanel will pre-fill itself
   * with the file / format pair. The plain `selectIndex` path
   * remains available for in-app navigation (e.g. clicking an
   * index row) where no specific landing tab is requested. */
  selectIndexWithTab: (name, tab) => {
    set({ pendingIndexDetailTab: tab })
    get().selectIndex(name)
  },

  clearPendingIndexDetailIntent: () => {
    if (get().pendingIndexDetailTab === null) return
    set({ pendingIndexDetailTab: null })
  },

  fetchMapping: async (connectionId, index) => {
    if (get().activeConnectionId !== connectionId || get().selectedIndex !== index) return
    const requestSeq = allocateQueryRequestSeq()
    set({ mappingLoading: true, mappingError: null, mappingRequestSeq: requestSeq })
    const res = await workspaceRequest(() => window.searchApi.indices.mapping({ connectionId, index }))
    if (get().activeConnectionId !== connectionId || get().selectedIndex !== index || get().mappingRequestSeq !== requestSeq) return
    if (res.success && res.data) {
      set({
        mappingLoading: false,
        mapping: res.data.mapping,
        mappingError: null
      })
    } else {
      set({
        mappingLoading: false,
        mappingError: res.error?.message ?? '获取 Mapping 失败'
      })
    }
  },

  fetchSettings: async (connectionId, index) => {
    if (get().activeConnectionId !== connectionId || get().selectedIndex !== index) return
    const requestSeq = allocateQueryRequestSeq()
    set({ settingsLoading: true, settingsError: null, settingsRequestSeq: requestSeq })
    const res = await workspaceRequest(() => window.searchApi.indices.settings({ connectionId, index }))
    if (get().activeConnectionId !== connectionId || get().selectedIndex !== index || get().settingsRequestSeq !== requestSeq) return
    if (res.success && res.data) {
      set({
        settingsLoading: false,
        settings: res.data.settings,
        settingsError: null
      })
    } else {
      set({
        settingsLoading: false,
        settingsError: res.error?.message ?? '获取 Settings 失败'
      })
    }
  },

  refreshIndexDetail: async () => {
    const id = get().activeConnectionId
    const name = get().selectedIndex
    if (!id || !name) return
    await Promise.all([get().fetchMapping(id, name), get().fetchSettings(id, name)])
  },

  /* ------------------- Phase 5 actions ------------------- */

  setDocumentPage: (page) => {
    const id = get().activeConnectionId
    const name = get().selectedIndex
    const size = get().documentPageSize
    if (!id || !name) return
    set({ documentPage: page })
    void get().fetchDocumentPage(id, name, page, size)
  },

  setDocumentPageSize: (size) => {
    const id = get().activeConnectionId
    const name = get().selectedIndex
    if (!id || !name) return
    // Reset to page 1 when the size changes so we don't page past the end.
    set({ documentPageSize: size, documentPage: 1 })
    void get().fetchDocumentPage(id, name, 1, size)
  },

  fetchDocumentPage: async (connectionId, index, page, pageSize) => {
    const current = get()
    if (
      current.activeConnectionId !== connectionId ||
      current.selectedIndex !== index ||
      current.documentPage !== page ||
      current.documentPageSize !== pageSize
    ) return
    const requestSeq = allocateQueryRequestSeq()
    cancelSearchQuery(pendingDocumentQuery)
    const request = { connectionId, resourceName: index, requestSeq }
    pendingDocumentQuery = request
    set({ documentLoading: true, documentError: null, documentRequestSeq: requestSeq })
    const res = await workspaceRequest(() => window.searchApi.searchEngine.query({
      connectionId,
      resourceName: index,
      queryLanguage: queryLanguageForConnection(connectionId),
      query: queryLanguageForConnection(connectionId) === 'solr'
        ? { q: '*:*', start: (page - 1) * pageSize, rows: pageSize }
        : defaultBrowseBody(page, pageSize),
      requestSeq
    }))
    if (pendingDocumentQuery?.requestSeq === requestSeq) pendingDocumentQuery = null
    const compatibleRes = toDocumentSearchResponse(res)
    // Guard against stale responses when the user switches index / page
    // quickly. We only apply results whose (index, page, size) tuple still
    // matches the current state.
    const cur = get()
    if (
      cur.selectedIndex !== index ||
      cur.activeConnectionId !== connectionId ||
      cur.documentRequestSeq !== requestSeq ||
      cur.documentPage !== page ||
      cur.documentPageSize !== pageSize
    ) {
      return
    }
    if (!responseMatchesQuery(res, request)) {
      set({ documentLoading: false, documentError: '查询响应与当前请求不匹配' })
      return
    }
    if (compatibleRes.success && compatibleRes.data) {
      set({
        documentLoading: false,
        documentHits: compatibleRes.data.hits,
        documentTotal: compatibleRes.data.total,
        documentTotalRelation: compatibleRes.data.totalRelation,
        documentTook: compatibleRes.data.took,
        documentError: null
      })
    } else {
      set({
        documentLoading: false,
        documentError: compatibleRes.error?.message ?? '查询文档失败'
      })
    }
  },

  refreshDocumentPage: async () => {
    const id = get().activeConnectionId
    const name = get().selectedIndex
    if (!id || !name) return
    await get().fetchDocumentPage(
      id,
      name,
      get().documentPage,
      get().documentPageSize
    )
  },

  /* V0.3.6 B-2: DSL query tabs. Each tab is a self-contained
   * unit with its own target index, editor content, and last
   * result. Helpers are kept private to this section so the
   * public surface stays small. */

  /** Replace one tab in the list with a new value. Pure helper
   *  to keep the action bodies focused on their semantics. */
  _patchTab(
    tabs: DslTab[],
    id: string,
    patch: Partial<DslTab>
  ): DslTab[] {
    return tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
  },

  addDslTab: (opts) => {
    const currentIndex = get().selectedIndex ?? ''
    const id = crypto.randomUUID()
    // Default title is "查询 N" where N is the next ordinal so the
    // user gets a stable, predictable label. The user can rename
    // it later from the tab UI.
    const nextOrdinal = get().dslTabs.length + 1
    const title = opts?.title?.trim() || `查询 ${nextOrdinal}`
    const newTab: DslTab = {
      id,
      title,
      indexName: opts?.indexName?.trim() || currentIndex,
      dsl: get().activeConnectionId && queryLanguageForConnection(get().activeConnectionId!) === 'solr'
        ? '{\n  "q": "*:*",\n  "rows": 20\n}'
        : DEFAULT_DSL_BODY,
      results: null,
      loading: false,
      error: null
    }
    set((s) => ({
      dslTabs: [...s.dslTabs, newTab],
      activeDslTabId: id
    }))
    return id
  },

  closeDslTab: (id) => {
    cancelPendingDslQuery(id)
    const { dslTabs, activeDslTabId } = get()
    if (dslTabs.length === 0) return
    const idx = dslTabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    // If we're closing the last tab, just clear the list — the
    // next render of DslQueryPanel will auto-create a default
    // tab on its first mount.
    if (dslTabs.length === 1) {
      set({ dslTabs: [], activeDslTabId: null })
      return
    }
    // If we're closing the active tab, pick a neighbour. Prefer
    // the next tab (right) so the user perceives the list as
    // flowing left-to-right; fall back to the previous tab at the
    // very end.
    let nextActive: string | null = activeDslTabId
    if (activeDslTabId === id) {
      const candidate = dslTabs[idx + 1] ?? dslTabs[idx - 1]
      nextActive = candidate ? candidate.id : null
    }
    set({
      dslTabs: dslTabs.filter((t) => t.id !== id),
      activeDslTabId: nextActive
    })
  },

  selectDslTab: (id) => {
    if (!get().dslTabs.some((t) => t.id === id)) return
    set({ activeDslTabId: id })
  },

  renameDslTab: (id, title) => {
    const trimmed = title.trim()
    if (!trimmed) return false
    set((s) => ({
      dslTabs: s.dslTabs.map((t) =>
        t.id === id ? { ...t, title: trimmed } : t
      )
    }))
    return true
  },

  updateDslTabContent: (id, dsl) => {
    cancelPendingDslQuery(id)
    set((s) => ({
      dslTabs: get()._patchTab(s.dslTabs, id, { dsl, loading: false }),
      dslRequestSeq: { ...s.dslRequestSeq, [id]: allocateQueryRequestSeq() }
    }))
  },

  setDslTabIndex: (id, indexName) => {
    cancelPendingDslQuery(id)
    set((s) => ({
      dslTabs: get()._patchTab(s.dslTabs, id, {
        indexName: indexName.trim(), loading: false, results: null, error: null
      }),
      dslRequestSeq: { ...s.dslRequestSeq, [id]: allocateQueryRequestSeq() }
    }))
  },

  runDslTabQuery: async (id) => {
    const tab = get().dslTabs.find((t) => t.id === id)
    if (!tab) return null
    const connectionId = get().activeConnectionId
    if (!connectionId) return null
    const requestSeq = allocateQueryRequestSeq()
    const indexName = tab.indexName.trim()
    cancelPendingDslQuery(id)
    set((s) => ({
      dslRequestSeq: { ...s.dslRequestSeq, [id]: requestSeq }
    }))
    if (!tab.indexName.trim()) {
      // Mirror the same error envelope shape the rest of the
      // store uses so callers don't need to special-case it.
      const err = { success: false as const, error: { message: '请先填写目标索引' } }
      set((s) => ({
        dslTabs: get()._patchTab(s.dslTabs, id, {
          error: err.error.message,
          loading: false,
          results: null
        })
      }))
      return err
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(tab.dsl) as Record<string, unknown>
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set((s) => ({
        dslTabs: get()._patchTab(s.dslTabs, id, {
          error: `DSL JSON 解析失败：${msg}`,
          loading: false,
          results: null
        })
      }))
      return { success: false, error: { message: `DSL JSON 解析失败：${msg}` } }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      set((s) => ({
        dslTabs: get()._patchTab(s.dslTabs, id, {
          error: 'DSL 必须是 JSON 对象',
          loading: false,
          results: null
        })
      }))
      return { success: false, error: { message: 'DSL 必须是 JSON 对象' } }
    }
    set((s) => ({
      dslTabs: get()._patchTab(s.dslTabs, id, { loading: true, error: null })
    }))
    const request = { connectionId, resourceName: indexName, requestSeq }
    pendingDslQueries.set(id, request)
    const res = await workspaceRequest(() => window.searchApi.searchEngine.query({
      connectionId,
      resourceName: indexName,
      queryLanguage: queryLanguageForConnection(connectionId),
      query: parsed,
      requestSeq
    }))
    const compatibleRes = toDocumentSearchResponse(res)
    if (pendingDslQueries.get(id)?.requestSeq === requestSeq) pendingDslQueries.delete(id)
    // Race guard: drop if the tab was closed (or the active tab
    // changed its target, the connection changed, or a newer query
    // superseded this one.
    const currentTab = get().dslTabs.find((t) => t.id === id)
    if (
      !currentTab ||
      currentTab.indexName.trim() !== indexName ||
      get().activeConnectionId !== connectionId ||
      get().dslRequestSeq[id] !== requestSeq
    ) return null
    if (!responseMatchesQuery(res, request)) {
      set((s) => ({
        dslTabs: get()._patchTab(s.dslTabs, id, {
          loading: false, error: '查询响应与当前请求不匹配', results: null
        })
      }))
      return null
    }
    if (compatibleRes.success && compatibleRes.data) {
      set((s) => ({
        dslTabs: get()._patchTab(s.dslTabs, id, {
          loading: false,
          results: compatibleRes.data,
          error: null
        })
      }))
    } else {
      set((s) => ({
        dslTabs: get()._patchTab(s.dslTabs, id, {
          loading: false,
          error: compatibleRes.error?.message ?? '执行 DSL 查询失败',
          results: null
        })
      }))
    }
    return compatibleRes
  },

  clearDslTab: (id) => {
    cancelPendingDslQuery(id)
    set((s) => ({
      dslRequestSeq: { ...s.dslRequestSeq, [id]: allocateQueryRequestSeq() },
      dslTabs: get()._patchTab(s.dslTabs, id, {
        results: null,
        error: null,
        loading: false
      })
    }))
  },

  /* ------------------- Phase 6 actions ------------------- */

  runSimpleQuery: async (connectionId, index, body, queryLanguage) => {
    if (
      get().activeConnectionId !== connectionId ||
      get().selectedIndex !== index
    ) return null
    const requestSeq = allocateQueryRequestSeq()
    cancelSearchQuery(pendingSimpleQuery)
    const request = { connectionId, resourceName: index, requestSeq }
    pendingSimpleQuery = request
    set({ simpleLoading: true, simpleError: null, simpleRequestSeq: requestSeq })
    const res = await workspaceRequest(() => window.searchApi.searchEngine.query({
      connectionId,
      resourceName: index,
      queryLanguage: queryLanguage ?? queryLanguageForConnection(connectionId),
      query: body,
      requestSeq
    }))
    if (pendingSimpleQuery?.requestSeq === requestSeq) pendingSimpleQuery = null
    const compatibleRes = toDocumentSearchResponse(res)
    // Race guard: drop if the selected resource / connection changed or a
    // newer simple query superseded this one.
    if (
      get().activeConnectionId !== connectionId ||
      get().selectedIndex !== index ||
      get().simpleRequestSeq !== requestSeq
    ) return null
    if (!responseMatchesQuery(res, request)) {
      set({ simpleLoading: false, simpleError: '查询响应与当前请求不匹配' })
      return null
    }
    if (compatibleRes.success && compatibleRes.data) {
      set({
        simpleLoading: false,
        simpleResults: compatibleRes.data,
        simpleError: null
      })
    } else {
      set({
        simpleLoading: false,
        simpleError: compatibleRes.error?.message ?? '执行简单查询失败'
      })
    }
    return compatibleRes
  },

  /* ------------------- Phase 7 actions: document CRUD ------------------- */

  createDocument: async (req) => {
    const res = await window.searchApi.documents.create(req)
    if (get().activeConnectionId !== req.connectionId || get().selectedIndex !== req.index) return null
    if (res.success) {
      // Refresh the current browse page so the new document (or its
      // updated version) shows up without a manual reload.
      await get().fetchDocumentPage(
        req.connectionId,
        req.index,
        get().documentPage,
        get().documentPageSize
      )
    }
    return res
  },

  updateDocument: async (req) => {
    const res = await window.searchApi.documents.update(req)
    if (get().activeConnectionId !== req.connectionId || get().selectedIndex !== req.index) return null
    if (res.success) {
      await get().fetchDocumentPage(
        req.connectionId,
        req.index,
        get().documentPage,
        get().documentPageSize
      )
    }
    return res
  },

  deleteDocument: async (req) => {
    const res = await window.searchApi.documents.delete(req)
    if (get().activeConnectionId !== req.connectionId || get().selectedIndex !== req.index) return null
    if (res.success) {
      await get().fetchDocumentPage(
        req.connectionId,
        req.index,
        get().documentPage,
        get().documentPageSize
      )
    }
    return res
  },

  /* ------------------- Phase 13 actions: index CRUD ------------------- */

  createIndex: async (req) => {
    const res = await window.searchApi.indices.create(req)
    if (!res.success) return res
    // Refresh the index list so the new index shows up. If the active
    // connection changed mid-call, drop the result.
    if (get().activeConnectionId !== req.connectionId) return res
    await get().fetchIndices(req.connectionId)
    return res
  },

  deleteIndex: async (req) => {
    const res = await window.searchApi.indices.delete(req)
    if (!res.success) return res
    // If the deleted index was the one we had selected, clear the
    // detail state so the workspace falls back to the index list.
    if (get().activeConnectionId === req.connectionId && get().selectedIndex === req.index) {
      get().selectIndex(null)
    }
    // Refresh the index list so the deletion is reflected.
    if (get().activeConnectionId === req.connectionId) {
      await get().fetchIndices(req.connectionId)
    }
    return res
  },

  /* V0.3.1 A-1: close / open lifecycle. Closing a closed index or
   * opening an open one is a no-op on the ES side; the refresh
   * afterwards picks up the real `status` column from `_cat/indices`
   * so the table flips to the right tag immediately. */

  closeIndex: async (req) => {
    const res = await window.searchApi.indices.close(req)
    if (!res.success) return res
    if (get().activeConnectionId === req.connectionId) {
      await get().fetchIndices(req.connectionId)
    }
    return res
  },

  openIndex: async (req) => {
    const res = await window.searchApi.indices.open(req)
    if (!res.success) return res
    if (get().activeConnectionId === req.connectionId) {
      await get().fetchIndices(req.connectionId)
    }
    return res
  },

  /* V0.3.2 A-2: dynamic-settings update. Refetch the settings
   * payload for the targeted index on success so the user sees the
   * new value without manual refresh. We do not touch the index
   * list — settings updates don't change `status` / `health`. */

  updateIndexSettings: async (req) => {
    const res = await window.searchApi.indices.updateSettings(req)
    if (!res.success) return res
    if (
      get().activeConnectionId === req.connectionId &&
      get().selectedIndex === req.index
    ) {
      await get().fetchSettings(req.connectionId, req.index)
    }
    return res
  },

  /* V0.3.3 A-3: append-fields mapping update. Refetch the mapping
   * payload for the targeted index on success so the user sees the
   * new field list without manual refresh. We do not touch the
   * index list — mapping updates don't change `status` / `health`. */

  updateIndexMapping: async (req) => {
    const res = await window.searchApi.indices.updateMapping(req)
    if (!res.success) return res
    if (
      get().activeConnectionId === req.connectionId &&
      get().selectedIndex === req.index
    ) {
      await get().fetchMapping(req.connectionId, req.index)
    }
    return res
  },

  /* V0.3.4 A-4: alias list scoped to the currently active
   * connection. Race guard: drop the result if the user has switched
   * connections mid-flight (typical when the workspace header is
   * rebuilt). */

  fetchAliases: async (connectionId) => {
    if (get().activeConnectionId !== connectionId) return
    const requestSeq = allocateQueryRequestSeq()
    set({ aliasesLoading: true, aliasesError: null, aliasesRequestSeq: requestSeq })
    const res = await workspaceRequest(() => window.searchApi.aliases.list({ connectionId }))
    if (get().activeConnectionId !== connectionId || get().aliasesRequestSeq !== requestSeq) return
    if (res.success && res.data) {
      set({
        aliasesLoading: false,
        aliases: res.data.aliases,
        aliasesError: null
      })
    } else {
      set({
        aliasesLoading: false,
        aliasesError: res.error?.message ?? '获取 Alias 失败'
      })
    }
  },

  /* V0.3.4 A-4: alias add / delete. On success, refresh the
   * connection-scoped alias list so the Alias tab reflects the
   * change. The renderer shows server-side errors inline in the
   * modal (e.g. 400 on an invalid alias name), so we do not surface
   * them through the global workspace error state. */

  addAlias: async (req) => {
    const res = await window.searchApi.aliases.add(req)
    if (!res.success) return res
    if (get().activeConnectionId === req.connectionId) {
      await get().fetchAliases(req.connectionId)
    }
    return res
  },

  deleteAlias: async (req) => {
    const res = await window.searchApi.aliases.delete(req)
    if (!res.success) return res
    if (get().activeConnectionId === req.connectionId) {
      await get().fetchAliases(req.connectionId)
    }
    return res
  },

  /* V0.3.4 A-5: index template list scoped to the active connection.
   * Race guard mirrors fetchAliases. */

  fetchTemplates: async (connectionId) => {
    if (get().activeConnectionId !== connectionId) return
    const requestSeq = allocateQueryRequestSeq()
    set({ templatesLoading: true, templatesError: null, templatesRequestSeq: requestSeq })
    const res = await workspaceRequest(() => window.searchApi.indexTemplates.list({ connectionId }))
    if (get().activeConnectionId !== connectionId || get().templatesRequestSeq !== requestSeq) return
    if (res.success && res.data) {
      set({
        templatesLoading: false,
        templates: res.data.templates,
        templatesError: null
      })
    } else {
      set({
        templatesLoading: false,
        templatesError: res.error?.message ?? '获取索引模板失败'
      })
    }
  },

  /* V0.3.4 A-5: read a single template body. The result is returned
   * to the caller (TemplateEditorModal) and is not persisted in the
   * store — the modal owns the body for the duration of the
   * inspection. */

  inspectTemplate: async (req) => {
    const res = await window.searchApi.indexTemplates.get(req)
    if (get().activeConnectionId !== req.connectionId) return null
    return res
  },

  createTemplate: async (req) => {
    const res = await window.searchApi.indexTemplates.create(req)
    if (!res.success) return res
    if (get().activeConnectionId === req.connectionId) {
      await get().fetchTemplates(req.connectionId)
    }
    return res
  },

  deleteTemplate: async (req) => {
    const res = await window.searchApi.indexTemplates.delete(req)
    if (!res.success) return res
    if (get().activeConnectionId === req.connectionId) {
      await get().fetchTemplates(req.connectionId)
    }
    return res
  },

  /* ------------------- V0.3.9 E-7: shard management ------------------- */

  // A sequence also distinguishes overlapping refreshes and repeated visits
  // to the same resource after navigating away.
  fetchShards: async (connectionId, index) => {
    if (get().activeConnectionId !== connectionId || get().selectedIndex !== index) return
    const requestSeq = allocateQueryRequestSeq()
    set({ shardsLoading: true, shardsError: null, shardsRequestSeq: requestSeq })
    const res = await workspaceRequest(() => window.searchApi.indices.shards({ connectionId, index }))
    if (get().activeConnectionId !== connectionId || get().selectedIndex !== index || get().shardsRequestSeq !== requestSeq) return
    if (res.success && res.data) {
      set({
        shardsLoading: false,
        shards: res.data.shards,
        shardsError: null
      })
    } else {
      set({
        shardsLoading: false,
        shardsError: res.error?.message ?? '获取分片列表失败'
      })
    }
  },

  // Reroute is asynchronous on the ES side: the API returns an
  // ack immediately but the cluster state takes a moment to
  // converge. We re-fetch the shard table on success so the user
  // sees the new state, and surface server-side errors verbatim.
  relocateShard: async (req) => {
    const res = await window.searchApi.indices.relocateShard(req)
    if (!res.success) return res
    if (
      get().activeConnectionId === req.connectionId &&
      get().selectedIndex === req.index
    ) {
      await get().fetchShards(req.connectionId, req.index)
    }
    return res
  },

  cancelShardAllocation: async (req) => {
    const res = await window.searchApi.indices.cancelShardAllocation(req)
    if (!res.success) return res
    if (
      get().activeConnectionId === req.connectionId &&
      get().selectedIndex === req.index
    ) {
      await get().fetchShards(req.connectionId, req.index)
    }
    return res
  },

  /* V0.3.5 B-4: DSL favorites. These don't depend on the
   * active connection — favorites are global — so there is no
   * race-guard against `activeConnectionId`. The list is
   * fetched on app start (see App.tsx) and re-fetched every
   * time the modal opens. */

  fetchDslFavorites: async () => {
    set({ dslFavoritesLoading: true, dslFavoritesError: null })
    const res = await window.searchApi.dslFavorites.list()
    if (res.success && res.data) {
      set({
        dslFavoritesLoading: false,
        dslFavorites: res.data,
        dslFavoritesError: null
      })
    } else {
      set({
        dslFavoritesLoading: false,
        dslFavoritesError: res.error?.message ?? '获取 DSL 收藏失败'
      })
    }
  },

  createDslFavorite: async (input) => {
    const res = await window.searchApi.dslFavorites.create(input)
    if (!res.success) return res
    await get().fetchDslFavorites()
    return res
  },

  updateDslFavorite: async (input) => {
    const res = await window.searchApi.dslFavorites.update(input)
    if (!res.success) return res
    await get().fetchDslFavorites()
    return res
  },

  deleteDslFavorite: async (id) => {
    const res = await window.searchApi.dslFavorites.delete(id)
    if (!res.success) return res
    await get().fetchDslFavorites()
    return res
  },

  /* ------------------- Phase 13: import action ------------------- */

  runImport: async (req) => {
    const res = await window.searchApi.importDocs.execute(req)
    if (!res.success) return res
    // If the import landed in the index the user is currently
    // browsing, refresh that page so they see the new docs without
    // a manual reload. The store's race guard makes this safe even
    // if the user switches index before the request returns.
    const cur = get()
    if (
      cur.activeConnectionId === req.connectionId &&
      cur.selectedIndex === req.index
    ) {
      await cur.fetchDocumentPage(
        req.connectionId,
        req.index,
        cur.documentPage,
        cur.documentPageSize
      )
    }
    return res
  },

  clear: () => {
    cancelAllPendingSearchQueries()
    set({
      activeConnectionId: null,
      clusterLoading: false,
      clusterRequestSeq: allocateQueryRequestSeq(),
      serverInfoRequestSeq: allocateQueryRequestSeq(),
      mappingRequestSeq: allocateQueryRequestSeq(),
      settingsRequestSeq: allocateQueryRequestSeq(),
      aliasesRequestSeq: allocateQueryRequestSeq(),
      templatesRequestSeq: allocateQueryRequestSeq(),
      shardsRequestSeq: allocateQueryRequestSeq(),
      clusterInfo: null,
      clusterHealth: null,
      clusterError: null,
      indices: [],
      indexCount: 0,
      indicesLoading: false,
      indicesError: null,
      indicesRequestSeq: allocateQueryRequestSeq(),
      selectedIndex: null,
      mapping: null,
      mappingError: null,
      mappingLoading: false,
      settings: null,
      settingsError: null,
      settingsLoading: false,
      documentHits: [],
      documentTotal: 0,
      documentTotalRelation: 'eq',
      documentTook: 0,
      documentPage: 1,
      documentPageSize: DEFAULT_PAGE_SIZE,
      documentLoading: false,
      documentError: null,
      documentRequestSeq: allocateQueryRequestSeq(),
      capabilities: null,
      capabilitiesLoading: false,
      capabilitiesError: null,
      capabilitiesRequestSeq: allocateQueryRequestSeq(),
      // V0.3.6 B-2: tabs are scoped to a connection, so they
      // get wiped on sign-out alongside the rest of the
      // connection-scoped state.
      dslTabs: [],
      activeDslTabId: null,
      dslRequestSeq: {},
      simpleResults: null,
      simpleLoading: false,
      simpleError: null,
      simpleRequestSeq: allocateQueryRequestSeq(),
      serverInfo: null,
      serverInfoLoading: false,
      serverInfoError: null,
      // V0.3.4 A-4 + A-5: clear alias / template state so a fresh
      // sign-in doesn't briefly show stale entries.
      aliases: [],
      aliasesLoading: false,
      aliasesError: null,
      templates: [],
      templatesLoading: false,
      templatesError: null,
      // V0.3.9 E-7: clear shard state on workspace reset.
      shards: [],
      shardsLoading: false,
      shardsError: null,
      // V0.3.5 B-4: favorites are global, but we still reset the
      // loading flag so the UI doesn't spin forever if the user
      // signs out mid-fetch. The list itself is preserved across
      // `setActiveConnection` so re-selecting a connection (or
      // a different one) does not blow away the user's saved DSL.
      dslFavoritesLoading: false,
      dslFavoritesError: null,
      // V0.3.10 F-3: wipe the one-shot navigation intent on
      // workspace reset so a jump targeted at one connection's
      // index never survives a sign-out.
      pendingIndexDetailTab: null
    })
  }
}))
