/**
 * Renderer-side connection state.
 *
 * Owns the list of saved connections, the loading flag, and the last error.
 * All mutations go through `window.esApi.connections.*` IPC calls — the
 * renderer never touches the disk or the network directly.
 */

import { create } from 'zustand'
import type {
  ApiResponse,
  ConnectionFolder,
  ConnectionFolderInput,
  ConnectionTestResult,
  EsConnection,
  EsConnectionInput
} from '@shared/ipc'

interface ConnectionState {
  connections: EsConnection[]
  loading: boolean
  error: string | null
  lastTestResult: ConnectionTestResult | null

  folders: ConnectionFolder[]
  folderLoading: boolean
  folderError: string | null

  fetch: () => Promise<void>
  create: (input: EsConnectionInput) => Promise<boolean>
  update: (input: EsConnectionInput) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  test: (
    input: EsConnectionInput
  ) => Promise<ConnectionTestOutcome>
  clearError: () => void

  /* V0.3.9 E-3: lightweight move-to-folder action. Used by drag
   * and drop AND the row menu's "移动到目录" submenu. We reuse
   * the standard `update` IPC but pass only the fields that can
   * change (folderId) — the main-process service is responsible
   * for keeping the rest of the connection intact. */
  moveConnectionToFolder: (
    id: string,
    folderId: string | null
  ) => Promise<boolean>

  fetchFolders: () => Promise<void>
  createFolder: (input: ConnectionFolderInput) => Promise<boolean>
  updateFolder: (input: ConnectionFolderInput) => Promise<boolean>
  removeFolder: (id: string) => Promise<boolean>
}

/** Result of `test`: discriminated union so callers don't have to read
 *  the global `error` field as a side effect. */
export type ConnectionTestOutcome =
  | { ok: true; result: ConnectionTestResult }
  | { ok: false; error: string }

function unwrap<T>(
  res: ApiResponse<T>,
  onSuccess?: (data: T) => void
): boolean {
  if (res.success) {
    if (onSuccess) onSuccess(res.data as T)
    return true
  }
  return false
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: [],
  loading: false,
  error: null,
  lastTestResult: null,

  folders: [],
  folderLoading: false,
  folderError: null,

  fetch: async () => {
    set({ loading: true, error: null })
    const res = await window.esApi.connections.list()
    if (res.success) {
      set({ connections: res.data ?? [], loading: false })
    } else {
      set({ loading: false, error: res.error?.message ?? '加载连接失败' })
    }
  },

  create: async (input) => {
    set({ error: null })
    const res = await window.esApi.connections.create(input)
    if (unwrap(res)) {
      const listRes = await window.esApi.connections.list()
      if (listRes.success) set({ connections: listRes.data ?? [] })
      return true
    }
    set({ error: res.error?.message ?? '新增连接失败' })
    return false
  },

  update: async (input) => {
    set({ error: null })
    const res = await window.esApi.connections.update(input)
    if (unwrap(res)) {
      const listRes = await window.esApi.connections.list()
      if (listRes.success) set({ connections: listRes.data ?? [] })
      return true
    }
    set({ error: res.error?.message ?? '更新连接失败' })
    return false
  },

  remove: async (id) => {
    set({ error: null })
    const res = await window.esApi.connections.delete(id)
    if (unwrap(res)) {
      const listRes = await window.esApi.connections.list()
      if (listRes.success) set({ connections: listRes.data ?? [] })
      return true
    }
    set({ error: res.error?.message ?? '删除连接失败' })
    return false
  },

  // V0.3.9 E-3: drag-and-drop and the row menu's "移动到目录"
  // action both go through here. The main-process update keeps
  // every other field intact, so passing only `id` + `folderId`
  // is sufficient. After a successful move we patch the local
  // list optimistically — the IPC reload happens in `update`
  // but skipping it for the optimistic case keeps the UI
  // responsive on slow connections.
  moveConnectionToFolder: async (id, folderId) => {
    const current = useConnectionStore.getState().connections.find(
      (c) => c.id === id
    )
    if (!current) return false
    if (current.folderId === folderId) return true
    // Optimistic patch for snappy feedback; the authoritative
    // refresh fires from `update` below.
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === id ? { ...c, folderId } : c
      )
    }))
    const res = await window.esApi.connections.update({
      id,
      name: current.name,
      url: current.url,
      authType: current.authType,
      username: current.username,
      // V0.3.9 security: a move doesn't need the password. Sending
      // it would also be wasteful; the service treats a blank
      // password as "keep the stored one" so the stored credential
      // is left intact without ever leaving the renderer store.
      password: undefined,
      folderId
    })
    if (res.success) {
      const listRes = await window.esApi.connections.list()
      if (listRes.success) set({ connections: listRes.data ?? [] })
      return true
    }
    // Revert the optimistic patch on failure so the UI matches
    // what's on disk.
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === id ? { ...c, folderId: current.folderId ?? null } : c
      ),
      error: res.error?.message ?? '移动连接失败'
    }))
    return false
  },

  test: async (input) => {
    // Tests don't update the global `error` field — the discriminated
    // return value lets the caller decide how to surface failures
    // (form-level Alert vs. toast message). We do keep `lastTestResult`
    // in sync so the page can show the most recent successful probe.
    const res = await window.esApi.connections.test(input)
    if (res.success && res.data) {
      set({ lastTestResult: res.data })
      return { ok: true, result: res.data }
    }
    return { ok: false, error: res.error?.message ?? '测试连接失败' }
  },

  clearError: () => set({ error: null }),

  /* -------------------------- Folder CRUD -------------------------- */

  fetchFolders: async () => {
    set({ folderLoading: true, folderError: null })
    const res = await window.esApi.connectionFolders.list()
    if (res.success) {
      set({ folders: res.data ?? [], folderLoading: false })
    } else {
      set({
        folderLoading: false,
        folderError: res.error?.message ?? '加载目录失败'
      })
    }
  },

  createFolder: async (input) => {
    set({ folderError: null })
    const res = await window.esApi.connectionFolders.create(input)
    if (res.success && res.data) {
      set((state) => ({ folders: [...state.folders, res.data as ConnectionFolder] }))
      return true
    }
    set({ folderError: res.error?.message ?? '新建目录失败' })
    return false
  },

  updateFolder: async (input) => {
    set({ folderError: null })
    const res = await window.esApi.connectionFolders.update(input)
    if (res.success && res.data) {
      const updated = res.data
      set((state) => ({
        folders: state.folders.map((f) => (f.id === updated.id ? updated : f))
      }))
      return true
    }
    set({ folderError: res.error?.message ?? '更新目录失败' })
    return false
  },

  removeFolder: async (id) => {
    set({ folderError: null })
    const res = await window.esApi.connectionFolders.delete(id)
    if (res.success) {
      set((state) => ({
        folders: state.folders.filter((f) => f.id !== id),
        // Connections inside the deleted folder are now folderId = null
        // on disk; refresh the list so the sidebar reflects that.
        connections: state.connections.map((c) =>
          c.folderId === id ? { ...c, folderId: null } : c
        )
      }))
      return true
    }
    set({ folderError: res.error?.message ?? '删除目录失败' })
    return false
  }
}))
