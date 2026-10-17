import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchConnection } from '../../src/shared/searchEngine'
import { SearchEngineError } from '../../src/main/search/errors'

const state = vi.hoisted(() => ({
  connections: [] as SearchConnection[],
  folders: [] as Array<{ id: string; name: string; parentId: string | null; createdAt: string; updatedAt: string }>,
  adapter: { testConnection: vi.fn() }
}))

vi.mock('../../src/main/store/connectionStore', () => ({
  loadConnections: vi.fn(() => state.connections.map((item) => ({ ...item }))),
  saveConnections: vi.fn((items: SearchConnection[]) => { state.connections = items.map((item) => ({ ...item })) }),
  loadConnectionFolders: vi.fn(() => state.folders.map((item) => ({ ...item }))),
  saveConnectionFolders: vi.fn((items: typeof state.folders) => { state.folders = items.map((item) => ({ ...item })) }),
  resolveConnection: vi.fn((id: string) => state.connections.find((item) => item.id === id)),
  ConnectionNotFoundError: class ConnectionNotFoundError extends Error {}
}))

vi.mock('../../src/main/search/adapterRegistry', () => ({
  listEnabledAdapters: vi.fn(() => [
    { type: 'elasticsearch', displayName: 'Elasticsearch', authSchemes: ['none', 'basic'] },
    { type: 'opensearch', displayName: 'OpenSearch', authSchemes: ['none', 'basic'] },
    { type: 'solr', displayName: 'Apache Solr', authSchemes: ['none', 'basic'] }
  ]),
  getSearchEngineAdapter: vi.fn(async () => state.adapter)
}))

vi.mock('../../src/main/search/serverVersionCache', () => ({
  invalidateServerInfoCache: vi.fn()
}))

import {
  createConnection,
  listConnections,
  testConnection,
  updateConnection
} from '../../src/main/services/connection.service'

beforeEach(() => {
  state.connections = []
  state.folders = []
  state.adapter.testConnection.mockReset()
  state.adapter.testConnection.mockResolvedValue({ reachable: true, version: '9.0.0' })
})

describe('generic connection service', () => {
  it('defaults omitted engineType to Elasticsearch and redacts passwords from responses', () => {
    const result = createConnection({ name: 'legacy', url: 'http://localhost:9200', authType: 'basic', username: 'elastic', password: 'secret' })
    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('password')
    expect(state.connections[0]).toMatchObject({ engineType: 'elasticsearch', password: 'secret' })
    expect(listConnections().data?.[0]).not.toHaveProperty('password')
  })

  it.each(['http://user:pass@example.test:9200', 'http://localhost:9200/?token=secret', 'http://localhost:9200/#secret'])('rejects unsafe URL %s', (url) => {
    const result = createConnection({ name: 'bad', url, authType: 'none' })
    expect(result.success).toBe(false)
    expect(result.error?.message).toMatch(/不能包含|有效/)
  })

  it('keeps a stored password when updating with a blank password', () => {
    state.connections = [{
      id: 'c1', name: 'existing', engineType: 'solr', url: 'http://localhost:8983/solr',
      authType: 'basic', username: 'admin', password: 'stored', folderId: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    }]
    const result = updateConnection({ id: 'c1', name: 'renamed', engineType: 'solr', url: 'http://localhost:8983/solr', authType: 'basic', username: 'admin', password: '' })
    expect(result.success).toBe(true)
    expect(state.connections[0].password).toBe('stored')
    expect(result.data).not.toHaveProperty('password')
  })

  it('selects the persisted engine when testing a legacy-shaped input', async () => {
    state.connections = [{
      id: 'c2', name: 'os', engineType: 'opensearch', url: 'http://localhost:9200', authType: 'none',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    }]
    const result = await testConnection({ id: 'c2', name: 'os', url: 'http://localhost:9200', authType: 'none' })
    expect(result.success).toBe(true)
    expect(state.adapter.testConnection).toHaveBeenCalledWith(expect.objectContaining({ engineType: 'opensearch' }))
  })

  it('redacts transport error details and credentials from test responses', async () => {
    state.adapter.testConnection.mockRejectedValue(new SearchEngineError({
      engineType: 'solr', code: 'auth_failed', message: 'Authorization failed for http://user:secret@example.test'
    }))
    const result = await testConnection({ name: 'solr', engineType: 'solr', url: 'http://example.test/solr', authType: 'basic', username: 'user', password: 'secret' })
    expect(result.success).toBe(false)
    expect(result.error?.message).toBe('认证失败，请检查用户名和密码')
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
