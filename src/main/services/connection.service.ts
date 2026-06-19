/**
 * Connection business logic.
 *
 * Runs in the Electron main process — the only place allowed to talk to
 * Elasticsearch. All ES requests for the test-connection flow go through
 * Node 18+'s built-in `fetch`; no new runtime dependency is required.
 *
 * Phase 2 scope: CRUD on locally persisted connections + a `test` call that
 * pings the configured Elasticsearch endpoint and returns basic cluster info.
 */

import { randomUUID } from 'node:crypto'
import { loadConnections, saveConnections } from '../store/connectionStore'
import type {
  ApiResponse,
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

function validateInput(input: EsConnectionInput, isUpdate: boolean): void {
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

/* ------------------------------- CRUD API ------------------------------- */

function nowIso(): string {
  return new Date().toISOString()
}

function normalize(input: EsConnectionInput): EsConnection {
  const authType = input.authType
  return {
    id: input.id ?? randomUUID(),
    name: input.name.trim(),
    url: input.url.trim().replace(/\/+$/, ''),
    authType,
    username: authType === 'basic' ? input.username?.trim() : undefined,
    password: authType === 'basic' ? input.password : undefined,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
}

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
    validateInput({ ...input, id: undefined }, false)
    const conn = normalize(input)
    const list = loadConnections()
    list.push(conn)
    saveConnections(list)
    return { success: true, data: conn }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

export function updateConnection(
  input: EsConnectionInput
): ApiResponse<EsConnection> {
  try {
    validateInput(input, true)
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
      updatedAt: nowIso()
    }
    list[idx] = merged
    saveConnections(list)
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
    validateInput({ ...input, id: input.id }, false)
    // Build an in-memory connection (not persisted) for the test request.
    const conn: EsConnection = normalize(input)
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
