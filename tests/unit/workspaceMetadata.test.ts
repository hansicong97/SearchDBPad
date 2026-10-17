import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

function deferred() {
  let resolve!: (value: any) => void
  const promise = new Promise<any>(next => { resolve = next })
  return { promise, resolve }
}

const cases = [
  { name: 'cluster', api: 'cluster', method: 'info', run: () => useWorkspaceStore.getState().fetchCluster('conn-a'), data: (value: string) => ({ clusterName: value }), state: 'clusterInfo', loading: 'clusterLoading', error: 'clusterError' },
  { name: 'version', api: 'searchEngine', method: 'detect', run: () => useWorkspaceStore.getState().fetchServerInfo('conn-a'), data: (value: string) => ({ version: value }), state: 'serverInfo', loading: 'serverInfoLoading', error: 'serverInfoError' },
  { name: 'mapping', api: 'indices', method: 'mapping', run: () => useWorkspaceStore.getState().fetchMapping('conn-a', 'books'), data: (value: string) => ({ mapping: { value } }), state: 'mapping', loading: 'mappingLoading', error: 'mappingError' },
  { name: 'settings', api: 'indices', method: 'settings', run: () => useWorkspaceStore.getState().fetchSettings('conn-a', 'books'), data: (value: string) => ({ settings: { value } }), state: 'settings', loading: 'settingsLoading', error: 'settingsError' },
  { name: 'aliases', api: 'aliases', method: 'list', run: () => useWorkspaceStore.getState().fetchAliases('conn-a'), data: (value: string) => ({ aliases: [value] }), state: 'aliases', loading: 'aliasesLoading', error: 'aliasesError' },
  { name: 'templates', api: 'indexTemplates', method: 'list', run: () => useWorkspaceStore.getState().fetchTemplates('conn-a'), data: (value: string) => ({ templates: [value] }), state: 'templates', loading: 'templatesLoading', error: 'templatesError' },
  { name: 'shards', api: 'indices', method: 'shards', run: () => useWorkspaceStore.getState().fetchShards('conn-a', 'books'), data: (value: string) => ({ shards: [value] }), state: 'shards', loading: 'shardsLoading', error: 'shardsError' }
] as const

let api: Record<string, Record<string, ReturnType<typeof vi.fn>>>
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  useWorkspaceStore.getState().clear()
  useWorkspaceStore.setState({ activeConnectionId: 'conn-a', selectedIndex: 'books' })
  const success = () => Promise.resolve({ success: true, data: {} })
  api = { cluster: { info: vi.fn(success), health: vi.fn(success) },
    searchEngine: { detect: vi.fn(success), capabilities: vi.fn(success), resources: vi.fn(async () => ({ success: true, data: { connectionId: 'conn-a', resources: [], resourceCount: 0 } })) },
    indices: { mapping: vi.fn(success), settings: vi.fn(success), shards: vi.fn(success) },
    aliases: { list: vi.fn(success) }, indexTemplates: { list: vi.fn(success) } }
  vi.stubGlobal('window', { searchApi: api })
})

describe('workspace metadata lifecycle', () => {
  it('settles document, simple and DSL query transport rejections and clears loading', async () => {
    api.searchEngine.query = vi.fn().mockRejectedValue(new Error('transport secret'))
    await useWorkspaceStore.getState().fetchDocumentPage('conn-a', 'books', 1, 20)
    await useWorkspaceStore.getState().runSimpleQuery('conn-a', 'books', {})
    const id = useWorkspaceStore.getState().addDslTab({ indexName: 'books' })
    await useWorkspaceStore.getState().runDslTabQuery(id)
    expect(useWorkspaceStore.getState()).toMatchObject({ documentLoading: false, simpleLoading: false, documentError: '请求失败，请重试', simpleError: '请求失败，请重试' })
    expect(useWorkspaceStore.getState().dslTabs.find(tab => tab.id === id)).toMatchObject({ loading: false, error: '请求失败，请重试' })
  })
  it.each(cases)('keeps the latest overlapping $name response', async item => {
    const first = deferred()
    const second = deferred()
    api[item.api][item.method].mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const oldRun = item.run()
    const newRun = item.run()
    second.resolve({ success: true, data: item.data('new') })
    await newRun
    const latest = (useWorkspaceStore.getState() as any)[item.state]
    first.resolve({ success: true, data: item.data('old') })
    await oldRun
    expect((useWorkspaceStore.getState() as any)[item.state]).toEqual(latest)
    expect((useWorkspaceStore.getState() as any)[item.loading]).toBe(false)
  })

  it.each(cases)('settles a rejected $name IPC request without exposing transport secrets', async item => {
    api[item.api][item.method].mockRejectedValueOnce(new Error('Authorization: password https://secret@example.test'))
    await item.run()
    const state = useWorkspaceStore.getState() as any
    expect(state[item.loading]).toBe(false)
    expect(state[item.error]).toEqual(expect.any(String))
    expect(state[item.error]).not.toMatch(/Authorization|password|secret|example/)
  })

  it('resets cluster loading and invalidates an earlier connection visit', async () => {
    const pending = deferred()
    api.cluster.info.mockReturnValueOnce(pending.promise)
    const oldRun = useWorkspaceStore.getState().fetchCluster('conn-a')
    useWorkspaceStore.getState().setActiveConnection(null)
    expect(useWorkspaceStore.getState().clusterLoading).toBe(false)
    useWorkspaceStore.setState({ activeConnectionId: 'conn-a' })
    pending.resolve({ success: true, data: { clusterName: 'old visit' } })
    await oldRun
    expect(useWorkspaceStore.getState().clusterInfo).toBeNull()
  })

  it('clears resource loading and invalidates mapping/settings when deselecting', async () => {
    const mapping = deferred()
    const settings = deferred()
    api.indices.mapping.mockReturnValueOnce(mapping.promise)
    api.indices.settings.mockReturnValueOnce(settings.promise)
    const oldMapping = useWorkspaceStore.getState().fetchMapping('conn-a', 'books')
    const oldSettings = useWorkspaceStore.getState().fetchSettings('conn-a', 'books')
    useWorkspaceStore.getState().selectIndex(null)
    expect(useWorkspaceStore.getState()).toMatchObject({ mappingLoading: false, settingsLoading: false })
    useWorkspaceStore.setState({ selectedIndex: 'books' })
    mapping.resolve({ success: true, data: { mapping: { old: true } } })
    settings.resolve({ success: true, data: { settings: { old: true } } })
    await Promise.all([oldMapping, oldSettings])
    expect(useWorkspaceStore.getState()).toMatchObject({ mapping: null, settings: null })
  })
})
