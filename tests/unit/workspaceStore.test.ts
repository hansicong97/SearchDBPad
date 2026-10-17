import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useConnectionStore } from '../../src/renderer/stores/connection.store'
import type { SearchEngineCapabilities } from '../../src/shared/searchEngine'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

const capabilities = (overrides: Partial<SearchEngineCapabilities> = {}): SearchEngineCapabilities => ({
  resourceCatalog: true, documentQuery: true, documentWrite: true, schema: true,
  indexManagement: true, bulkTransfer: true, tasks: true, indices: true,
  mappings: true, settings: true, aliases: true, indexTemplates: true,
  dslQuery: true, simpleQuery: true, importExport: true, openCloseIndex: true,
  shardManagement: true, maintenance: true, deepPagination: true,
  reindex: true, queryMutation: true, ...overrides
})

describe('workspace resource/query race guards', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useConnectionStore.setState({ connections: [] })
    useWorkspaceStore.getState().clear()
    useWorkspaceStore.setState({
      activeConnectionId: 'conn-a',
      selectedIndex: 'books',
      documentPage: 1,
      documentPageSize: 20,
      indices: [],
      indexCount: 0
    })
  })

  it('keeps the newest overlapping document query result', async () => {
    const first = deferred<any>()
    const second = deferred<any>()
    let call = 0
    const query = vi.fn(() => (++call === 1 ? first.promise : second.promise))
    ;(globalThis as any).window = {
      searchApi: {
        searchEngine: {
          query
        }
      }
    }

    const firstRun = useWorkspaceStore.getState().fetchDocumentPage('conn-a', 'books', 1, 20)
    const secondRun = useWorkspaceStore.getState().fetchDocumentPage('conn-a', 'books', 1, 20)
    second.resolve({ success: true, data: {
      ...query.mock.calls[1][0],
      took: 2, total: 1, totalRelation: 'eq', hits: [{ id: 'new', fields: {} }]
    } })
    await secondRun
    first.resolve({ success: true, data: {
      ...query.mock.calls[0][0],
      took: 1, total: 1, totalRelation: 'eq', hits: [{ id: 'old', fields: {} }]
    } })
    await firstRun

    expect(query).toHaveBeenCalledTimes(2)
    expect(useWorkspaceStore.getState().documentHits[0]?.id).toBe('new')
  })

  it('drops a resource response after switching connections', async () => {
    const pending = deferred<any>()
    const emptyCapabilities = capabilities({
      resourceCatalog: true
    })
    const resources = vi.fn((connectionId: string) =>
      connectionId === 'conn-a'
        ? pending.promise
        : Promise.resolve({
            success: true,
            data: { connectionId, resourceCount: 0, resources: [] }
          })
    )
    ;(globalThis as any).window = {
      searchApi: {
        cluster: {
          info: vi.fn(async () => ({ success: true, data: {} })),
          health: vi.fn(async () => ({ success: true, data: {} }))
        },
        searchEngine: {
          resources,
          detect: vi.fn(async () => ({ success: true, data: {} })),
          capabilities: vi.fn(async () => ({
            success: true,
            data: { connectionId: 'conn-b', engineType: 'elasticsearch', capabilities: emptyCapabilities }
          }))
        },
        aliases: {
          list: vi.fn(async () => ({ success: true, data: { aliases: [] } }))
        },
        indexTemplates: {
          list: vi.fn(async () => ({ success: true, data: { templates: [] } }))
        }
      }
    }
    const run = useWorkspaceStore.getState().fetchIndices('conn-a')
    useWorkspaceStore.getState().setActiveConnection('conn-b')
    pending.resolve({ success: true, data: {
      connectionId: 'conn-a', resourceCount: 1,
      resources: [{ name: 'books', kind: 'index', documentCount: 10 }]
    } })
    await run

    expect(useWorkspaceStore.getState().indices).toEqual([])
    expect(useWorkspaceStore.getState().activeConnectionId).toBe('conn-b')
  })

  it('keeps the newest overlapping resource refresh', async () => {
    const first = deferred<any>()
    const second = deferred<any>()
    let call = 0
    const resources = vi.fn(() => (++call === 1 ? first.promise : second.promise))
    ;(globalThis as any).window = {
      searchApi: { searchEngine: { resources } }
    }

    const firstRun = useWorkspaceStore.getState().fetchIndices('conn-a')
    const secondRun = useWorkspaceStore.getState().fetchIndices('conn-a')
    second.resolve({ success: true, data: {
      connectionId: 'conn-a', resourceCount: 1,
      resources: [{ name: 'books', kind: 'index', documentCount: 20 }]
    } })
    await secondRun
    first.resolve({ success: true, data: {
      connectionId: 'conn-a', resourceCount: 1,
      resources: [{ name: 'books', kind: 'index', documentCount: 10 }]
    } })
    await firstRun

    expect(resources).toHaveBeenCalledTimes(2)
    expect(useWorkspaceStore.getState().indices).toEqual([
      { name: 'books', kind: 'index', documentCount: 20 }
    ])
  })

  it('does not apply a same-named resource from a previous connection', async () => {
    const oldConnection = deferred<any>()
    const currentConnection = deferred<any>()
    const resources = vi.fn((connectionId: string) =>
      connectionId === 'conn-a' ? oldConnection.promise : currentConnection.promise
    )
    ;(globalThis as any).window = {
      searchApi: { searchEngine: { resources } }
    }

    const oldRun = useWorkspaceStore.getState().fetchIndices('conn-a')
    useWorkspaceStore.setState({
      activeConnectionId: 'conn-b',
      indices: [],
      indexCount: 0,
      indicesLoading: false,
      indicesError: null
    })
    const currentRun = useWorkspaceStore.getState().fetchIndices('conn-b')
    currentConnection.resolve({ success: true, data: {
      connectionId: 'conn-b', resourceCount: 1,
      resources: [{ name: 'books', kind: 'collection', documentCount: 30 }]
    } })
    await currentRun
    oldConnection.resolve({ success: true, data: {
      connectionId: 'conn-a', resourceCount: 1,
      resources: [{ name: 'books', kind: 'index', documentCount: 10 }]
    } })
    await oldRun

    expect(useWorkspaceStore.getState().indices).toEqual([
      { name: 'books', kind: 'collection', documentCount: 30 }
    ])
    expect(useWorkspaceStore.getState().activeConnectionId).toBe('conn-b')
  })

  it('clears capabilities when the current connection capability probe fails', async () => {
    useWorkspaceStore.setState({ capabilities: capabilities() })
    ;(globalThis as any).window = {
      searchApi: { searchEngine: { capabilities: vi.fn(async () => ({
        success: false, error: { message: 'probe failed' }
      })) } }
    }
    await useWorkspaceStore.getState().fetchCapabilities('conn-a')

    expect(useWorkspaceStore.getState().capabilities).toBeNull()
    expect(useWorkspaceStore.getState().capabilitiesError).toBe('probe failed')
  })

  it.each([
    { connectionId: 'conn-b' },
    { resourceName: 'other' },
    { requestSeq: -1 }
  ])('rejects a successful response from the wrong query context: %j', async mismatch => {
    const query = vi.fn(async request => ({ success: true, data: {
      ...request, ...mismatch, took: 1, total: 1, totalRelation: 'eq',
      hits: [{ id: 'wrong', fields: {} }]
    } }))
    ;(globalThis as any).window = { searchApi: { searchEngine: { query } } }

    await useWorkspaceStore.getState().fetchDocumentPage('conn-a', 'books', 1, 20)
    expect(useWorkspaceStore.getState().documentHits).toEqual([])
    expect(useWorkspaceStore.getState().documentLoading).toBe(false)
    expect(useWorkspaceStore.getState().documentError).toBeTruthy()
  })

  it('cancels a superseded query and cancels the current query on workspace clear', async () => {
    const first = deferred<any>()
    const second = deferred<any>()
    const cancel = vi.fn(async () => ({ success: true, data: { cancelled: true } }))
    const query = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    ;(globalThis as any).window = { searchApi: { searchEngine: { query, cancel } } }

    const firstRun = useWorkspaceStore.getState().fetchDocumentPage('conn-a', 'books', 1, 20)
    const secondRun = useWorkspaceStore.getState().fetchDocumentPage('conn-a', 'books', 1, 20)
    expect(cancel).toHaveBeenNthCalledWith(1, {
      connectionId: 'conn-a', resourceName: 'books', requestSeq: query.mock.calls[0][0].requestSeq
    })
    useWorkspaceStore.getState().clear()
    expect(cancel).toHaveBeenNthCalledWith(2, {
      connectionId: 'conn-a', resourceName: 'books', requestSeq: query.mock.calls[1][0].requestSeq
    })
    first.resolve({ success: false, error: { code: 'cancelled', message: 'cancelled' } })
    second.resolve({ success: false, error: { code: 'cancelled', message: 'cancelled' } })
    await Promise.all([firstRun, secondRun])
    expect(useWorkspaceStore.getState().documentError).toBeNull()
    expect(useWorkspaceStore.getState().documentLoading).toBe(false)
  })

  it('cancels a tab query when its target changes and drops its result', async () => {
    const pending = deferred<any>()
    const cancel = vi.fn(async () => ({ success: true, data: { cancelled: true } }))
    const query = vi.fn(() => pending.promise)
    ;(globalThis as any).window = { searchApi: { searchEngine: { query, cancel } } }
    const id = useWorkspaceStore.getState().addDslTab()
    const run = useWorkspaceStore.getState().runDslTabQuery(id)
    const request = query.mock.calls[0][0]
    useWorkspaceStore.getState().setDslTabIndex(id, 'other')
    expect(cancel).toHaveBeenCalledWith({
      connectionId: 'conn-a', resourceName: 'books', requestSeq: request.requestSeq
    })
    pending.resolve({ success: true, data: {
      ...request, took: 1, total: 1, totalRelation: 'eq', hits: [{ id: 'stale', fields: {} }]
    } })
    expect(await run).toBeNull()
    expect(useWorkspaceStore.getState().dslTabs[0]).toMatchObject({ indexName: 'other', loading: false, results: null })
  })

  it.each(['createDocument', 'updateDocument', 'deleteDocument'] as const)(
    'ignores %s completion after changing to another connection with the same resource', async operation => {
      const pending = deferred<any>()
      const method = operation === 'createDocument' ? 'create' : operation === 'updateDocument' ? 'update' : 'delete'
      const query = vi.fn()
      ;(globalThis as any).window = {
        searchApi: { documents: { [method]: vi.fn(() => pending.promise) }, searchEngine: { query } }
      }
      const run = useWorkspaceStore.getState()[operation]({ connectionId: 'conn-a', index: 'books', id: '1', source: {} })
      useWorkspaceStore.setState({ activeConnectionId: 'conn-b', selectedIndex: 'books' })
      pending.resolve({ success: true, data: {} })
      expect(await run).toBeNull()
      expect(query).not.toHaveBeenCalled()
    }
  )

  it('does not clear another connection same-named resource when deletion completes', async () => {
    const pending = deferred<any>()
    const resources = vi.fn()
    ;(globalThis as any).window = {
      searchApi: { indices: { delete: vi.fn(() => pending.promise) }, searchEngine: { resources } }
    }
    const run = useWorkspaceStore.getState().deleteIndex({ connectionId: 'conn-a', index: 'books' })
    useWorkspaceStore.setState({ activeConnectionId: 'conn-b', selectedIndex: 'books' })
    pending.resolve({ success: true, data: {} })
    await run
    expect(useWorkspaceStore.getState().selectedIndex).toBe('books')
    expect(resources).not.toHaveBeenCalled()
  })
})
