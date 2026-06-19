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
 * The store does not know how to talk to Elasticsearch directly — it only
 * goes through `window.esApi.cluster.*`, `window.esApi.indices.*` and
 * `window.esApi.documents.*`. The main process is the only place that
 * touches the network.
 */

import { create } from 'zustand'
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
  EsIndexInfo
} from '@shared/ipc'

/** Default page size for the document browse tab. */
const DEFAULT_PAGE_SIZE = 20

interface WorkspaceState {
  activeConnectionId: string | null

  clusterInfo: ClusterInfo | null
  clusterHealth: ClusterHealth | null
  clusterLoading: boolean
  clusterError: string | null

  indices: EsIndexInfo[]
  indexCount: number
  indicesLoading: boolean
  indicesError: string | null

  /* Phase 4: index detail */
  selectedIndex: string | null
  mapping: Record<string, unknown> | null
  mappingLoading: boolean
  mappingError: string | null
  settings: Record<string, unknown> | null
  settingsLoading: boolean
  settingsError: string | null

  /* Phase 5: document browse tab */
  documentHits: DocumentHit[]
  documentTotal: number
  documentTotalRelation: 'eq' | 'gte'
  documentTook: number
  documentPage: number /* 1-based */
  documentPageSize: number
  documentLoading: boolean
  documentError: string | null

  /* Phase 5: DSL query tab */
  dslResults: DocumentSearchResult | null
  dslLoading: boolean
  dslError: string | null

  /* Phase 6: simple query tab */
  simpleResults: DocumentSearchResult | null
  simpleLoading: boolean
  simpleError: string | null

  setActiveConnection: (id: string | null) => void

  fetchCluster: (connectionId: string) => Promise<void>
  fetchIndices: (connectionId: string) => Promise<void>
  refreshAll: () => Promise<void>

  selectIndex: (name: string | null) => void
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

  runDslQuery: (
    connectionId: string,
    index: string,
    body: Record<string, unknown>
  ) => Promise<ApiResponse<DocumentSearchResult> | null>

  /* Phase 6 actions */
  runSimpleQuery: (
    connectionId: string,
    index: string,
    body: Record<string, unknown>
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

  clear: () => void
}

function readError<T>(res: ApiResponse<T>, fallback: string): string {
  return res.error?.message ?? fallback
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

  indices: [],
  indexCount: 0,
  indicesLoading: false,
  indicesError: null,

  selectedIndex: null,
  mapping: null,
  mappingLoading: false,
  mappingError: null,
  settings: null,
  settingsLoading: false,
  settingsError: null,

  documentHits: [],
  documentTotal: 0,
  documentTotalRelation: 'eq',
  documentTook: 0,
  documentPage: 1,
  documentPageSize: DEFAULT_PAGE_SIZE,
  documentLoading: false,
  documentError: null,

  dslResults: null,
  dslLoading: false,
  dslError: null,

  simpleResults: null,
  simpleLoading: false,
  simpleError: null,

  setActiveConnection: (id) => {
    if (id === get().activeConnectionId) return
    set({
      activeConnectionId: id,
      // Clear previous connection's data so the UI doesn't briefly show
      // stale cluster info for the wrong connection.
      clusterInfo: null,
      clusterHealth: null,
      clusterError: null,
      indices: [],
      indexCount: 0,
      indicesError: null,
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
      dslResults: null,
      dslLoading: false,
      dslError: null,
      // Phase 6: also clear the simple-query state.
      simpleResults: null,
      simpleLoading: false,
      simpleError: null
    })
    if (id) {
      void get().fetchCluster(id)
      void get().fetchIndices(id)
    }
  },

  fetchCluster: async (connectionId) => {
    set({ clusterLoading: true, clusterError: null })
    const [infoRes, healthRes] = await Promise.all([
      window.esApi.cluster.info({ connectionId }),
      window.esApi.cluster.health({ connectionId })
    ])
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
    set({ indicesLoading: true, indicesError: null })
    const res = await window.esApi.indices.list({ connectionId })
    if (res.success && res.data) {
      set({
        indicesLoading: false,
        indices: res.data.indices,
        indexCount: res.data.indexCount,
        indicesError: null
      })
    } else {
      set({
        indicesLoading: false,
        indicesError: res.error?.message ?? '获取索引列表失败'
      })
    }
  },

  refreshAll: async () => {
    const id = get().activeConnectionId
    if (!id) return
    await Promise.all([get().fetchCluster(id), get().fetchIndices(id)])
  },

  selectIndex: (name) => {
    if (name === null) {
      set({
        selectedIndex: null,
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
        dslResults: null,
        dslLoading: false,
        dslError: null,
        simpleResults: null,
        simpleLoading: false,
        simpleError: null
      })
      return
    }
    if (name === get().selectedIndex) return
    const id = get().activeConnectionId
    set({
      selectedIndex: name,
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
      dslResults: null,
      dslLoading: false,
      dslError: null,
      simpleResults: null,
      simpleLoading: false,
      simpleError: null
    })
    if (id) {
      void get().fetchMapping(id, name)
      void get().fetchSettings(id, name)
      void get().fetchDocumentPage(id, name, 1, DEFAULT_PAGE_SIZE)
    }
  },

  fetchMapping: async (connectionId, index) => {
    set({ mappingLoading: true, mappingError: null })
    const res = await window.esApi.indices.mapping({ connectionId, index })
    // Guard: only apply if this fetch is still for the active selection.
    if (get().selectedIndex !== index) return
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
    set({ settingsLoading: true, settingsError: null })
    const res = await window.esApi.indices.settings({ connectionId, index })
    if (get().selectedIndex !== index) return
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
    set({ documentLoading: true, documentError: null })
    const res = await window.esApi.documents.search({
      connectionId,
      index,
      query: defaultBrowseBody(page, pageSize)
    })
    // Guard against stale responses when the user switches index / page
    // quickly. We only apply results whose (index, page, size) tuple still
    // matches the current state.
    const cur = get()
    if (
      cur.selectedIndex !== index ||
      cur.documentPage !== page ||
      cur.documentPageSize !== pageSize
    ) {
      return
    }
    if (res.success && res.data) {
      set({
        documentLoading: false,
        documentHits: res.data.hits,
        documentTotal: res.data.total,
        documentTotalRelation: res.data.totalRelation,
        documentTook: res.data.took,
        documentError: null
      })
    } else {
      set({
        documentLoading: false,
        documentError: res.error?.message ?? '查询文档失败'
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

  runDslQuery: async (connectionId, index, body) => {
    set({ dslLoading: true, dslError: null })
    const res = await window.esApi.documents.search({
      connectionId,
      index,
      query: body
    })
    // Race guard: drop if the selected index changed during the call.
    if (get().selectedIndex !== index) return null
    if (res.success && res.data) {
      set({
        dslLoading: false,
        dslResults: res.data,
        dslError: null
      })
    } else {
      set({
        dslLoading: false,
        dslError: res.error?.message ?? '执行 DSL 查询失败'
      })
    }
    return res
  },

  /* ------------------- Phase 6 actions ------------------- */

  runSimpleQuery: async (connectionId, index, body) => {
    set({ simpleLoading: true, simpleError: null })
    const res = await window.esApi.documents.search({
      connectionId,
      index,
      query: body
    })
    // Race guard: drop if the selected index changed during the call.
    if (get().selectedIndex !== index) return null
    if (res.success && res.data) {
      set({
        simpleLoading: false,
        simpleResults: res.data,
        simpleError: null
      })
    } else {
      set({
        simpleLoading: false,
        simpleError: res.error?.message ?? '执行简单查询失败'
      })
    }
    return res
  },

  /* ------------------- Phase 7 actions: document CRUD ------------------- */

  createDocument: async (req) => {
    const res = await window.esApi.documents.create(req)
    if (get().selectedIndex !== req.index) return null
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
    const res = await window.esApi.documents.update(req)
    if (get().selectedIndex !== req.index) return null
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
    const res = await window.esApi.documents.delete(req)
    if (get().selectedIndex !== req.index) return null
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

  clear: () => {
    set({
      activeConnectionId: null,
      clusterInfo: null,
      clusterHealth: null,
      clusterError: null,
      indices: [],
      indexCount: 0,
      indicesError: null,
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
      dslResults: null,
      dslLoading: false,
      dslError: null,
      simpleResults: null,
      simpleLoading: false,
      simpleError: null
    })
  }
}))