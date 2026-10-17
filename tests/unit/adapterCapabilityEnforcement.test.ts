import { describe, expect, it, vi } from 'vitest'
import { emptySearchEngineCapabilities } from '../../src/shared/searchEngine'
import { requireOperation, type SearchEngineAdapter } from '../../src/main/search/adapter.types'

const connection = {
  id: 'capability-fixture', name: 'fixture', engineType: 'elasticsearch' as const,
  url: 'http://localhost:9200', authType: 'none' as const, createdAt: '', updatedAt: ''
}

function adapterWith(overrides: Record<string, unknown> = {}): SearchEngineAdapter {
  const capabilities = emptySearchEngineCapabilities()
  capabilities.documentQuery = true
  capabilities.dslQuery = true
  return {
    type: 'elasticsearch', displayName: 'Elasticsearch',
    manifest: {
      manifestVersion: 1, adapterVersion: 'test', type: 'elasticsearch',
      displayName: 'Elasticsearch', protocolFamily: 'test', supportedVersions: ['6.x'],
      authSchemes: ['none'], resourceModel: 'index', queryLanguages: ['elasticsearch-dsl'],
      transferFormats: ['json'], capabilities
    },
    detect: vi.fn(), testConnection: vi.fn(),
    getCapabilities: vi.fn(() => capabilities),
    ...overrides
  } as unknown as SearchEngineAdapter
}

describe('adapter capability enforcement', () => {
  it('blocks an implemented operation when the resolved connection capability is false', async () => {
    const capabilities = emptySearchEngineCapabilities()
    capabilities.documentQuery = false
    const query = vi.fn().mockResolvedValue({})
    const adapter = adapterWith({ getCapabilities: vi.fn(() => capabilities), queryDocuments: query })

    await expect(requireOperation(adapter, 'queryDocuments')(connection, {
      resourceName: 'books', queryLanguage: 'elasticsearch-dsl', query: {}
    })).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(query).not.toHaveBeenCalled()
  })

  it('re-evaluates version-dependent capabilities for every invocation', async () => {
    const first = emptySearchEngineCapabilities()
    first.documentQuery = true
    const second = emptySearchEngineCapabilities()
    second.documentQuery = false
    const getCapabilities = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const query = vi.fn().mockResolvedValue({})
    const adapter = adapterWith({ getCapabilities, queryDocuments: query })
    const invoke = requireOperation(adapter, 'queryDocuments')
    const input = { resourceName: 'books', queryLanguage: 'elasticsearch-dsl' as const, query: {} }

    await invoke(connection, input)
    await expect(invoke(connection, input)).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(getCapabilities).toHaveBeenCalledTimes(2)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('checks task-specific reindex and query-mutation flags', async () => {
    const capabilities = emptySearchEngineCapabilities()
    capabilities.tasks = true
    capabilities.reindex = false
    capabilities.queryMutation = false
    const executeTask = vi.fn().mockResolvedValue({})
    const adapter = adapterWith({ getCapabilities: vi.fn(() => capabilities), executeTask })
    const invoke = requireOperation(adapter, 'executeTask')

    await expect(invoke(connection, { resourceName: 'books', operation: 'reindex', body: {} })).rejects.toMatchObject({ code: 'unsupported_capability' })
    await expect(invoke(connection, { resourceName: 'books', operation: 'deleteByQuery', body: {} })).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(executeTask).not.toHaveBeenCalled()
  })

  it('preserves async export streaming while enforcing bulk capability', async () => {
    const capabilities = emptySearchEngineCapabilities()
    capabilities.bulkTransfer = true
    capabilities.importExport = true
    const exportBatches = vi.fn(async function* () { yield [] })
    const adapter = adapterWith({ getCapabilities: vi.fn(() => capabilities), exportBatches })
    const batches = requireOperation(adapter, 'exportBatches')(connection, { index: 'books', maxRows: 1 })
    await expect((async () => { for await (const _batch of batches) { /* consume */ } })()).resolves.toBeUndefined()
    expect(exportBatches).toHaveBeenCalledTimes(1)
  })

  it('rejects a disabled streaming export before starting the adapter iterator', async () => {
    const exportBatches = vi.fn(async function* () { yield [] })
    const adapter = adapterWith({ exportBatches })
    const batches = requireOperation(adapter, 'exportBatches')(connection, { index: 'books', maxRows: 1 })

    await expect((async () => { for await (const _batch of batches) { /* consume */ } })()).rejects.toMatchObject({
      code: 'unsupported_capability'
    })
    expect(exportBatches).not.toHaveBeenCalled()
  })

  it('closes the underlying streaming iterator when its consumer stops early', async () => {
    const capabilities = emptySearchEngineCapabilities()
    capabilities.bulkTransfer = true
    capabilities.importExport = true
    const cleanup = vi.fn()
    const exportBatches = vi.fn(async function* () {
      try {
        yield [{ id: '1', fields: { title: 'first' } }]
        yield [{ id: '2', fields: { title: 'second' } }]
      } finally {
        cleanup()
      }
    })
    const adapter = adapterWith({ getCapabilities: vi.fn(() => capabilities), exportBatches })

    for await (const _batch of requireOperation(adapter, 'exportBatches')(connection, { index: 'books', maxRows: 1 })) break

    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
