/**
 * Connection business logic.
 *
 * Runs in the Electron main process — the only place allowed to talk to
 * Elasticsearch. All ES requests for the test-connection flow go through
 * Node 18+'s built-in `fetch`; no new runtime dependency is required.
 *
 * Phase 2 scope: CRUD on locally persisted connections + a `test` call that
 * pings the configured Elasticsearch endpoint and returns basic cluster info.
 *
 * Phase 15 (UI update): adds folder CRUD. Folders are user-defined groups
 * rendered in the sidebar; deleting a folder keeps its connections
 * (they move to the implicit "未分组" bucket).
 */

import { randomUUID } from 'node:crypto'
import {
  loadConnectionFolders,
  loadConnections,
  saveConnectionFolders,
  saveConnections
} from '../store/connectionStore'
import { invalidateServerInfoCache } from '../search/serverVersionCache'
import type {
  ApiResponse,
  ConnectionFolder,
  ConnectionFolderInput,
  ConnectionTestResult,
  EsConnection,
  EsConnectionInput
} from '../../shared/ipc'

/* ------------------------------ Validation ------------------------------ */

export class ConnectionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionValidationError'
  }
}

function validateConnectionInput(
  input: EsConnectionInput,
  isUpdate: boolean
): void {
  if (!input.name || !input.name.trim()) {
    throw new ConnectionValidationError('连接名称不能为空')
  }
  if (!input.url || !input.url.trim()) {
    throw new ConnectionValidationError('Elasticsearch 地址不能为空')
  }
  const url = input.url.trim()
  if (!/^https?:\/\//i.test(url)) {
    throw new ConnectionValidationError('地址必须以 http:// 或 https:// 开头')
  }
  if (input.authType === 'basic' && (!input.username || !input.username.trim())) {
    throw new ConnectionValidationError('Basic Auth 模式下用户名不能为空')
  }
  if (input.authType !== 'basic' && input.authType !== 'none') {
    throw new ConnectionValidationError('不支持的认证方式')
  }
  // Update must carry an id
  if (isUpdate && !input.id) {
    throw new ConnectionValidationError('更新连接时缺少 id')
  }
}

function validateFolderInput(input: ConnectionFolderInput, isUpdate: boolean): void {
  if (!input.name || !input.name.trim()) {
    throw new ConnectionValidationError('目录名称不能为空')
  }
  if (isUpdate && !input.id) {
    throw new ConnectionValidationError('更新目录时缺少 id')
  }
}

/** Reject `folderId` values that don't resolve to an existing folder.
 *  `null` / `undefined` always pass (means "未分组"). */
function assertFolderExists(folderId: string | null | undefined): void {
  if (!folderId) return
  const folders = loadConnectionFolders()
  if (!folders.some((f) => f.id === folderId)) {
    throw new ConnectionValidationError('所选目录不存在')
  }
}

/* ------------------------------- Helpers ------------------------------- */

function nowIso(): string {
  return new Date().toISOString()
}

/** Lowercased name comparison for the unique-name rule. */
function nameTaken(name: string, ignoreId?: string): boolean {
  const target = name.trim().toLowerCase()
  return loadConnectionFolders().some(
    (f) => f.name.trim().toLowerCase() === target && f.id !== ignoreId
  )
}

function normalizeConnection(input: EsConnectionInput): EsConnection {
  const authType = input.authType
  return {
    id: input.id ?? randomUUID(),
    name: input.name.trim(),
    // V0.3.0: only Elasticsearch is supported today. The field is set
    // here so persisted entries always carry `engineType`, making the
    // legacy-read backfill in connectionStore a no-op for new data.
    engineType: 'elasticsearch',
    url: input.url.trim().replace(/\/+$/, ''),
    authType,
    username: authType === 'basic' ? input.username?.trim() : undefined,
    password: authType === 'basic' ? input.password : undefined,
    folderId: input.folderId ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
}

function normalizeFolder(input: ConnectionFolderInput): ConnectionFolder {
  return {
    id: input.id ?? randomUUID(),
    name: input.name.trim(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
}

/* ------------------------ Connections CRUD ------------------------ */

export function listConnections(): ApiResponse<EsConnection[]> {
  try {
    return { success: true, data: loadConnections() }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

export function createConnection(
  input: EsConnectionInput
): ApiResponse<EsConnection> {
  try {
    validateConnectionInput({ ...input, id: undefined }, false)
    assertFolderExists(input.folderId ?? null)
    const conn = normalizeConnection(input)
    const list = loadConnections()
    list.push(conn)
    saveConnections(list)
    // New connection — any cached server info for it (shouldn't exist
    // yet, but defend against partial writes from earlier sessions)
    // is now meaningless.
    invalidateServerInfoCache(conn.id)
    return { success: true, data: conn }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

export function updateConnection(
  input: EsConnectionInput
): ApiResponse<EsConnection> {
  try {
    validateConnectionInput(input, true)
    assertFolderExists(input.folderId ?? null)
    const list = loadConnections()
    const idx = list.findIndex((c) => c.id === input.id)
    if (idx < 0) {
      return { success: false, error: { message: '未找到对应连接' } }
    }
    const existing = list[idx]
    const merged: EsConnection = {
      ...existing,
      name: input.name.trim(),
      url: input.url.trim().replace(/\/+$/, ''),
      authType: input.authType,
      username:
        input.authType === 'basic' ? input.username?.trim() : undefined,
      password:
        input.authType === 'basic' ? input.password : undefined,
      folderId: input.folderId ?? existing.folderId ?? null,
      // V0.3.0: preserve the persisted engine type. `existing` comes
      // from loadConnections() so it is already backfilled, but the
      // fallback guards against any future caller that hands us a raw
      // record. The trailing position wins over `...existing`.
      engineType: existing.engineType ?? 'elasticsearch',
      updatedAt: nowIso()
    }
    list[idx] = merged
    saveConnections(list)
    // URL / auth may have changed; drop the cached server info so the
    // adapter re-detects on next use.
    invalidateServerInfoCache(merged.id)
    return { success: true, data: merged }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

export function deleteConnection(id: string): ApiResponse<{ id: string }> {
  try {
    const list = loadConnections()
    const next = list.filter((c) => c.id !== id)
    if (next.length === list.length) {
      return { success: false, error: { message: '未找到对应连接' } }
    }
    saveConnections(next)
    invalidateServerInfoCache(id)
    return { success: true, data: { id } }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

/* -------------------------- Folder CRUD -------------------------- */

export function listConnectionFolders(): ApiResponse<ConnectionFolder[]> {
  try {
    return { success: true, data: loadConnectionFolders() }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

export function createConnectionFolder(
  input: ConnectionFolderInput
): ApiResponse<ConnectionFolder> {
  try {
    validateFolderInput({ ...input, id: undefined }, false)
    const name = input.name.trim()
    if (nameTaken(name)) {
      throw new ConnectionValidationError('目录名称已存在')
    }
    const folder = normalizeFolder({ ...input, name })
    const list = loadConnectionFolders()
    list.push(folder)
    saveConnectionFolders(list)
    return { success: true, data: folder }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

export function updateConnectionFolder(
  input: ConnectionFolderInput
): ApiResponse<ConnectionFolder> {
  try {
    validateFolderInput(input, true)
    const name = input.name.trim()
    if (nameTaken(name, input.id)) {
      throw new ConnectionValidationError('目录名称已存在')
    }
    const list = loadConnectionFolders()
    const idx = list.findIndex((f) => f.id === input.id)
    if (idx < 0) {
      return { success: false, error: { message: '未找到对应目录' } }
    }
    const merged: ConnectionFolder = {
      ...list[idx],
      name,
      updatedAt: nowIso()
    }
    list[idx] = merged
    saveConnectionFolders(list)
    return { success: true, data: merged }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

/** Delete a folder and move any connections that belonged to it into
 *  the implicit "未分组" bucket (folderId = null). */
export function deleteConnectionFolder(
  id: string
): ApiResponse<{ id: string }> {
  try {
    const folders = loadConnectionFolders()
    const next = folders.filter((f) => f.id !== id)
    if (next.length === folders.length) {
      return { success: false, error: { message: '未找到对应目录' } }
    }
    saveConnectionFolders(next)

    const conns = loadConnections().map((c) =>
      c.folderId === id ? { ...c, folderId: null, updatedAt: nowIso() } : c
    )
    saveConnections(conns)

    return { success: true, data: { id } }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

/* ------------------------------ Test ES ------------------------------ */

function buildAuthHeader(conn: EsConnection): Record<string, string> {
  if (conn.authType !== 'basic' || !conn.username) return {}
  // node:buffer is available in main; password may be undefined for empty input
  const raw = `${conn.username}:${conn.password ?? ''}`
  const encoded = Buffer.from(raw, 'utf-8').toString('base64')
  return { Authorization: `Basic ${encoded}` }
}

async function fetchJson(
  url: string,
  headers: Record<string, string>
): Promise<unknown> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', ...headers }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`
    )
  }
  return res.json()
}

export async function testConnection(
  input: EsConnectionInput
): Promise<ApiResponse<ConnectionTestResult>> {
  try {
    validateConnectionInput({ ...input, id: input.id }, false)
    // Build an in-memory connection (not persisted) for the test request.
    const conn: EsConnection = normalizeConnection(input)
    const headers = buildAuthHeader(conn)
    const base = conn.url

    // Hit both / and /_cluster/health in parallel for richer feedback.
    const [rootRes, healthRes] = await Promise.allSettled([
      fetchJson(base + '/', headers),
      fetchJson(base + '/_cluster/health', headers)
    ])

    // If even the root call failed, surface a single clear error.
    if (rootRes.status === 'rejected') {
      return {
        success: false,
        error: { message: `无法连接 Elasticsearch: ${(rootRes.reason as Error).message}` }
      }
    }

    const root = rootRes.value as {
      cluster_name?: string
      version?: { number?: string }
    }
    const health =
      healthRes.status === 'fulfilled'
        ? (healthRes.value as {
            status?: 'green' | 'yellow' | 'red'
          })
        : undefined

    const result: ConnectionTestResult = {
      reachable: true,
      clusterName: root.cluster_name,
      version: root.version?.number,
      health: health?.status ?? 'unknown'
    }
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}