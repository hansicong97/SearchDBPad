import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionFolder } from '../../src/shared/ipc'
import type { SearchConnection } from '../../src/shared/searchEngine'

const storage = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  get: vi.fn(),
  set: vi.fn()
}))

vi.mock('electron-store', () => ({
  default: class MockStore {
    get = storage.get
    set = storage.set
  }
}))

import {
  ConnectionNotFoundError,
  loadConnectionFolders,
  loadConnections,
  resolveConnection,
  saveConnectionFolders,
  saveConnections
} from '../../src/main/store/connectionStore'

function connection(id: string, overrides: Partial<SearchConnection> = {}): SearchConnection {
  return {
    id,
    name: id,
    engineType: 'elasticsearch',
    url: 'http://localhost:9200',
    authType: 'none',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function folder(id: string, overrides: Partial<ConnectionFolder> = {}): ConnectionFolder {
  return {
    id,
    name: id,
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  storage.values.clear()
  storage.get.mockImplementation((key: string, fallback: unknown) => storage.values.get(key) ?? fallback)
  storage.set.mockImplementation((key: string, value: unknown) => storage.values.set(key, value))
})

describe('connection persistence compatibility', () => {
  it('reads missing collections as empty without persisting defaults', () => {
    expect(loadConnections()).toEqual([])
    expect(loadConnectionFolders()).toEqual([])
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('defaults legacy connections to Elasticsearch without changing saved rows', () => {
    const { engineType: _engineType, ...legacy } = connection('legacy')
    storage.values.set('connections', [legacy])

    expect(loadConnections()).toEqual([{ ...legacy, engineType: 'elasticsearch' }])
    expect(legacy).not.toHaveProperty('engineType')
    expect(storage.values.get('connections')).toEqual([legacy])
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('preserves explicit engines and returns newest connections first', () => {
    const older = connection('older', { engineType: 'solr' })
    const newer = connection('newer', {
      engineType: 'opensearch',
      createdAt: '2026-02-01T00:00:00.000Z'
    })
    const saved = [older, newer]
    storage.values.set('connections', saved)

    expect(loadConnections()).toEqual([newer, older])
    expect(saved).toEqual([older, newer])
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('reads legacy folders as top-level and preserves explicit parents', () => {
    const { parentId: _parentId, ...legacy } = folder('legacy')
    const child = folder('child', { parentId: 'legacy' })
    const topLevel = folder('top-level')
    storage.values.set('folders', [legacy, child, topLevel])

    expect(loadConnectionFolders()).toEqual([{ ...legacy, parentId: null }, child, topLevel])
    expect(legacy).not.toHaveProperty('parentId')
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('returns folders oldest first without reordering persisted rows', () => {
    const older = folder('older')
    const newer = folder('newer', { createdAt: '2026-02-01T00:00:00.000Z' })
    const saved = [newer, older]
    storage.values.set('folders', saved)

    expect(loadConnectionFolders()).toEqual([older, newer])
    expect(saved).toEqual([newer, older])
  })

  it('resolves a connection by id and rejects a deleted connection', () => {
    const saved = connection('exists')
    storage.values.set('connections', [saved])

    expect(resolveConnection('exists')).toEqual(saved)
    expect(() => resolveConnection('deleted')).toThrow(ConnectionNotFoundError)
  })

  it('writes exactly the connection and folder data supplied by the service', () => {
    const connections = [connection('connection')]
    const folders = [folder('folder')]

    saveConnections(connections)
    saveConnectionFolders(folders)

    expect(storage.set).toHaveBeenNthCalledWith(1, 'connections', connections)
    expect(storage.set).toHaveBeenNthCalledWith(2, 'folders', folders)
  })
})
