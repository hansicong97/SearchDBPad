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
  ConnectionTestResult,
  EsConnection,
  EsConnectionInput
} from '@shared/ipc'

interface ConnectionState {
  connections: EsConnection[]
  loading: boolean
  error: string | null
  lastTestResult: ConnectionTestResult | null

  fetch: () => Promise<void>
  create: (input: EsConnectionInput) => Promise<boolean>
  update: (input: EsConnectionInput) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  test: (
    input: EsConnectionInput
  ) => Promise<ConnectionTestOutcome>
  clearError: () => void
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

  clearError: () => set({ error: null })
}))
