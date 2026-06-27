/**
 * Connection business logic.
 *
 * Runs in the Electron main process — the only place allowed to talk to
 * Elasticsearch. The `test` flow is routed through the search engine
 * adapter so it shares auth / headers / version handling with the
 * rest of the engine surface.
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
import { getSearchEngineAdapter } from '../search/adapterRegistry'
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

/** V0.3.9 E-5: when the caller leaves the name blank, generate a
 *  numbered default. We do this server-side rather than renderer-side
 *  so the saved record always carries a meaningful name even if the
 *  caller forgot to fill the field. */
function defaultConnectionName(): string {
  return `新建连接 ${loadConnections().length + 1}`
}

function defaultFolderName(): string {
  return `新建目录 ${loadConnectionFolders().length + 1}`
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

/** V0.3.9 E-4: a folder's `parentId` must point at an existing folder
 *  that is not the folder itself (no self-parent) and not a
 *  descendant (no cycles). `null` / `undefined` is always fine. */
function assertFolderParentValid(
  folderId: string | null | undefined,
  parentId: string | null | undefined,
  isUpdate: boolean
): void {
  if (!parentId) return
  const folders = loadConnectionFolders()
  if (!folders.some((f) => f.id === parentId)) {
    throw new ConnectionValidationError('父目录不存在')
  }
  if (isUpdate && folderId === parentId) {
    throw new ConnectionValidationError('目录不能以自身作为父目录')
  }
  // Walk descendants to reject cycles. Linear scan because the
  // folder list is small.
  if (isUpdate && folderId) {
    let cursor: string | null | undefined = parentId
    const seen = new Set<string>()
    while (cursor) {
      if (cursor === folderId) {
        throw new ConnectionValidationError('父目录不能是自身的子目录')
      }
      if (seen.has(cursor)) break
      seen.add(cursor)
      const parent: ConnectionFolder | undefined = folders.find(
        (f) => f.id === cursor
      )
      cursor = parent?.parentId ?? null
    }
  }
}

function normalizeConnection(input: EsConnectionInput): EsConnection {
  const authType = input.authType
  // E-5: only substitute the default name when the caller truly
  // left it blank (whitespace-only counts as blank). Any actual
  // user input is preserved verbatim.
  const trimmedName = input.name.trim()
  const name = trimmedName || defaultConnectionName()
  return {
    id: input.id ?? randomUUID(),
    name,
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
  const trimmedName = input.name.trim()
  const name = trimmedName || defaultFolderName()
  return {
    id: input.id ?? randomUUID(),
    name,
    parentId: input.parentId ?? null,
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
      name: input.name.trim() || existing.name || defaultConnectionName(),
      url: input.url.trim().replace(/\/+$/, ''),
      authType: input.authType,
      username:
        input.authType === 'basic' ? input.username?.trim() : undefined,
      // V0.3.9 security: a blank password on an update means "keep
      // what's stored". The renderer now intentionally leaves the
      // password field empty when editing so the saved credential
      // is never round-tripped through the form. Without this guard,
      // submitting an unchanged form would wipe the stored password.
      password:
        input.authType === 'basic'
          ? (input.password && input.password.length > 0
              ? input.password
              : existing.password)
          : undefined,
      // V0.3.9 bug fix: `??` falls through on both `undefined` and
      // `null`, so it cannot distinguish "not provided" from
      // "explicitly cleared (move to 未分组)". Use the `in` check so
      // an explicit `null` always clears folderId.
      folderId:
        'folderId' in input
          ? (input.folderId ?? null)
          : (existing.folderId ?? null),
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
    assertFolderParentValid(undefined, input.parentId ?? null, false)
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
    // Note: `parentId` is intentionally ignored on update to avoid
    // silently moving a folder's subtree. The renderer-side "新建
    // 子目录" path always creates a fresh folder, never re-parents.
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

/** V0.3.9 E-4: delete a folder and recursively delete every
 *  descendant folder. Connections that belonged to any deleted
 *  folder end up in the implicit "未分组" bucket (folderId =
 *  null). We collect the affected folder ids in one pass so a
 *  deep subtree only reads the disk once. */
export function deleteConnectionFolder(
  id: string
): ApiResponse<{ id: string }> {
  try {
    const folders = loadConnectionFolders()
    if (!folders.some((f) => f.id === id)) {
      return { success: false, error: { message: '未找到对应目录' } }
    }
    const toDelete = new Set<string>()
    const collect = (root: string): void => {
      toDelete.add(root)
      for (const f of folders) {
        if (f.parentId === root) collect(f.id)
      }
    }
    collect(id)
    saveConnectionFolders(folders.filter((f) => !toDelete.has(f.id)))

    const conns = loadConnections().map((c) =>
      c.folderId && toDelete.has(c.folderId)
        ? { ...c, folderId: null, updatedAt: nowIso() }
        : c
    )
    saveConnections(conns)

    return { success: true, data: { id } }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

/* ------------------------------ Test ES ------------------------------ */

// V0.3.1 C-1: connection-test goes through the SearchEngineAdapter
// instead of a private `fetch` path so that auth, request headers,
// version handling and error wrapping are shared with every other
// engine call. The adapter's `testConnection` already probes `/` and
// `/_cluster/health` in parallel and folds partial failures into a
// single `ConnectionTestResult`.

export async function testConnection(
  input: EsConnectionInput
): Promise<ApiResponse<ConnectionTestResult>> {
  try {
    validateConnectionInput({ ...input, id: input.id }, false)
    // Build an in-memory connection (not persisted) for the test request.
    const conn: EsConnection = normalizeConnection(input)
    const adapter = await getSearchEngineAdapter(conn.engineType)
    const result = await adapter.testConnection(conn)
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}