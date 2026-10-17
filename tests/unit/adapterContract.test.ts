import { describe, expect, it } from 'vitest'
import { listEnabledAdapters, resolveAdapter } from '../../src/main/search/adapterRegistry'
import { requireOperation } from '../../src/main/search/adapter.types'

describe('shipped adapter contracts', () => {
  it.each(['elasticsearch', 'opensearch', 'solr'] as const)('resolves the %s built-in with its declared operations', async (type) => {
    const adapter = await resolveAdapter(type)
    const manifest = listEnabledAdapters().find(item => item.type === type)
    expect(adapter.manifest).toEqual(manifest)
    expect(await adapter.getCapabilities()).toEqual(manifest?.capabilities)
    expect(adapter.manifest.manifestVersion).toBe(1)
    expect(adapter.manifest.adapterVersion).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+/)
  })

  it('rejects an unsupported Solr operation before any network request', async () => {
    const adapter = await resolveAdapter('solr')
    expect(() => requireOperation(adapter, 'getIndexMapping')).toThrow('不支持此操作')
    expect(adapter.manifest.capabilities.mappings).toBe(false)
  })
})
