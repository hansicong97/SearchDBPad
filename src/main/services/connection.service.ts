/**
 * Connection business logic.
 *
 * Runs in the Electron main process — the only place allowed to talk to
 * search engines. The `test` flow is routed through the selected search engine
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
import { getSearchEngineAdapter, listEnabledAdapters } from '../search/adapterRegistry'
import { toPublicSearchError } from '../search/errors'
import { invalidateServerInfoCache } from '../search/serverVersionCache'
import type {
  ApiResponse,
  ConnectionFolder,
  ConnectionFolderInput,
  ConnectionTestResult,
  SearchConnection,
  SearchConnectionInput
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
  input: SearchConnectionInput,
  isUpdate: boolean
): void {
  if (typeof input.name !== 'string' || input.name.trim().length > 64) {
    throw new ConnectionValidationError('连接名称不超过 64 个字符')
  }
  const manifest = listEnabledAdapters().find(item => item.type === (input.engineType ?? 'elasticsearch'))
  if (!manifest) throw new ConnectionValidationError('当前版本未启用此搜索引擎')
  if (!manifest.authSchemes.includes(input.authType)) {
    throw new ConnectionValidationError('所选引擎不支持此认证方式')
  }
  if (typeof input.url !== 'string' || !input.url.trim()) {
    throw new ConnectionValidationError('搜索引擎地址不能为空')
  }
  const url = input.url.trim()
  if (!/^https?:\/\//i.test(url)) {
    throw new ConnectionValidationError('地址必须以 http:// 或 https:// 开头')
  }
  let parsed: URL
  try { parsed = new URL(url) } catch {
    throw new ConnectionValidationError('请输入有效的 HTTP 或 HTTPS 地址')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new ConnectionValidationError('请输入有效的 HTTP 或 HTTPS 地址')
  }
  if (parsed.username || parsed.password || url.includes('?') || url.includes('#')) {
    throw new ConnectionValidationError('地址不能包含凭据、查询参数或片段；请在认证字段填写凭据')
  }
  if (input.authType === 'basic' && (!input.username || !input.username.trim())) {
    throw new ConnectionValidationError('Basic Auth 模式下用户名不能为空')
  }
  if (input.password !== undefined && typeof input.password !== 'string') throw new ConnectionValidationError('密码格式无效')
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

function normalizeConnection(input: SearchConnectionInput): SearchConnection {
  const authType = input.authType
  // E-5: only substitute the default name when the caller truly
  // left it blank (whitespace-only counts as blank). Any actual
  // user input is preserved verbatim.
  const trimmedName = input.name.trim()
  const name = trimmedName || defaultConnectionName()
  return {
    id: input.id ?? randomUUID(),
    name,
    engineType: input.engineType ?? 'elasticsearch',
    url: input.url.trim().replace(/\/+$/, ''),
    authType,
    username: authType === 'basic' ? input.username?.trim() : undefined,
    password: authType === 'basic' ? input.password : undefined,
    folderId: input.folderId ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
}

/** Secrets stay in the main-process store and are never returned over IPC. */
function publicConnection(connection: SearchConnection): SearchConnection {
  const { password: _password, ...safe } = connection
  return { ...safe, engineType: connection.engineType ?? 'elasticsearch' }
}

function connectionError<T>(error: unknown, operation: string): ApiResponse<T> {
  if (error instanceof ConnectionValidationError) {
    return { success: false, error: { code: 'invalid_request', operation, message: error.message } }
  }
  // Transport errors may carry URLs, server bodies, or credentials. Only the
  // allowlisted public code/message from the shared mapper crosses IPC.
  const safe = toPublicSearchError(error, operation)
  if (safe.code === 'http_error' || safe.code === 'operation_failed') {
    safe.message = '连接操作失败，请检查配置后重试'
    safe.code = 'connection_error'
  }
  return { success: false, error: safe }
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

export function listConnections(): ApiResponse<SearchConnection[]> {
  try {
    return { success: true, data: loadConnections().map(publicConnection) }
  } catch (err) {
    return connectionError(err, 'connection:list')
  }
}

export function createConnection(
  input: SearchConnectionInput
): ApiResponse<SearchConnection> {
  try {
    validateConnectionInput({ ...input, id: undefined }, false)
    assertFolderExists(input.folderId ?? null)
    const conn = normalizeConnection({ ...input, id: undefined })
    const list = loadConnections()
    list.push(conn)
    saveConnections(list)
    // New connection — any cached server info for it (shouldn't exist
    // yet, but defend against partial writes from earlier sessions)
    // is now meaningless.
    invalidateServerInfoCache(conn.id)
    return { success: true, data: publicConnection(conn) }
  } catch (err) {
    return connectionError(err, 'connection:create')
  }
}

export function updateConnection(
  input: SearchConnectionInput
): ApiResponse<SearchConnection> {
  try {
    const list = loadConnections()
    const idx = list.findIndex((c) => c.id === input.id)
    if (idx < 0) {
      return { success: false, error: {
        code: 'connection_not_found', operation: 'connection:update', message: '未找到对应连接，请重新选择连接'
      } }
    }
    const existing = list[idx]
    const normalizedInput = { ...input, engineType: input.engineType ?? existing.engineType ?? 'elasticsearch' }
    validateConnectionInput(normalizedInput, true)
    assertFolderExists(input.folderId ?? null)
    const merged: SearchConnection = {
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
      engineType: normalizedInput.engineType,
      updatedAt: nowIso()
    }
    list[idx] = merged
    saveConnections(list)
    // URL / auth may have changed; drop the cached server info so the
    // adapter re-detects on next use.
    invalidateServerInfoCache(merged.id)
    return { success: true, data: publicConnection(merged) }
  } catch (err) {
    return connectionError(err, 'connection:update')
  }
}

export function deleteConnection(id: string): ApiResponse<{ id: string }> {
  try {
    const list = loadConnections()
    const next = list.filter((c) => c.id !== id)
    if (next.length === list.length) {
      return { success: false, error: {
        code: 'connection_not_found', operation: 'connection:delete', message: '未找到对应连接，请重新选择连接'
      } }
    }
    saveConnections(next)
    invalidateServerInfoCache(id)
    return { success: true, data: { id } }
  } catch (err) {
    return connectionError(err, 'connection:delete')
  }
}

/* -------------------------- Folder CRUD -------------------------- */

export function listConnectionFolders(): ApiResponse<ConnectionFolder[]> {
  try {
    return { success: true, data: loadConnectionFolders() }
  } catch (err) {
    return connectionError(err, 'connection-folder:list')
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
    return connectionError(err, 'connection-folder:create')
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
      return { success: false, error: {
        code: 'resource_not_found', operation: 'connection-folder:update', message: '未找到对应目录，请刷新后重试'
      } }
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
    return connectionError(err, 'connection-folder:update')
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
      return { success: false, error: {
        code: 'resource_not_found', operation: 'connection-folder:delete', message: '未找到对应目录，请刷新后重试'
      } }
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
    return connectionError(err, 'connection-folder:delete')
  }
}

/* --------------------------- Test connection --------------------------- */

// V0.3.1 C-1: connection-test goes through the SearchEngineAdapter
// instead of a private `fetch` path so that auth, request headers,
// version handling and error wrapping are shared with every other
// engine call. The adapter's `testConnection` already probes `/` and
// `/_cluster/health` in parallel and folds partial failures into a
// single `ConnectionTestResult`.

export async function testConnection(
  input: SearchConnectionInput
): Promise<ApiResponse<ConnectionTestResult>> {
  try {
    const existing = input.id ? loadConnections().find(item => item.id === input.id) : undefined
    const testInput: SearchConnectionInput = {
      ...input,
      engineType: input.engineType ?? existing?.engineType ?? 'elasticsearch',
      username: input.username ?? existing?.username,
      password: input.authType === 'basic' && !input.password ? existing?.password : input.password
    }
    validateConnectionInput(testInput, false)
    // Build an in-memory connection (not persisted) for the test request.
    const conn: SearchConnection = normalizeConnection(testInput)
    const adapter = await getSearchEngineAdapter(conn.engineType)
    const result = await adapter.testConnection(conn)
    return { success: true, data: result }
  } catch (err) {
    return connectionError(err, 'connection:test')
  }
}
