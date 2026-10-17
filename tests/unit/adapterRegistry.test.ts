import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySearchEngineCapabilities } from '../../src/shared/searchEngine'
import type { SearchEngineManifest, SearchEngineType } from '../../src/shared/searchEngine'
import type { SearchEngineAdapter } from '../../src/main/search/adapter.types'

const paths = [
  '../../src/main/adapters/elasticsearch',
  '../../src/main/adapters/opensearch',
  '../../src/main/adapters/solr'
]
let manifests: Record<SearchEngineType, SearchEngineManifest>
let adapters: Record<SearchEngineType, SearchEngineAdapter>

function manifest(type: SearchEngineType): SearchEngineManifest {
  return {
    type, displayName: type, protocolFamily: type + '-rest', manifestVersion: 1,
    adapterVersion: '1.0.0', supportedVersions: ['1.x'], authSchemes: ['none'],
    resourceModel: 'index', capabilities: emptySearchEngineCapabilities(),
    queryLanguages: [], transferFormats: []
  }
}

beforeEach(() => {
  vi.resetModules()
  manifests = { elasticsearch: manifest('elasticsearch'), opensearch: manifest('opensearch'), solr: manifest('solr') }
  adapters = Object.fromEntries(Object.entries(manifests).map(([type, item]) => [type, {
    type, displayName: item.displayName, manifest: item,
    detect: vi.fn(), testConnection: vi.fn(), getCapabilities: () => ({ ...item.capabilities })
  }])) as unknown as Record<SearchEngineType, SearchEngineAdapter>
  vi.doMock(paths[0], () => ({ elasticsearchManifest: manifests.elasticsearch, elasticsearchAdapter: adapters.elasticsearch }))
  vi.doMock(paths[1], () => ({ opensearchManifest: manifests.opensearch, opensearchAdapter: adapters.opensearch }))
  vi.doMock(paths[2], () => ({ solrManifest: manifests.solr, solrAdapter: adapters.solr }))
})

afterEach(() => {
  for (const path of paths) vi.doUnmock(path)
})

async function registry() {
  return import('../../src/main/search/adapterRegistry')
}

describe('built-in adapter registry', () => {
  it('lists all registered engine manifests without executing engine operations', async () => {
    const { listEnabledAdapters } = await registry()
    expect(listEnabledAdapters().map(item => item.type)).toEqual(['elasticsearch', 'opensearch', 'solr'])
    for (const adapter of Object.values(adapters)) expect(adapter.detect).not.toHaveBeenCalled()
  })

  it('returns independent public metadata snapshots', async () => {
    const { listEnabledAdapters } = await registry()
    const first = listEnabledAdapters()[0]
    first.supportedVersions.push('999.x')
    first.capabilities.documentWrite = true
    first.authSchemes.push('basic')
    first.transferFormats.push('csv')
    first.queryLanguages.push('elasticsearch-dsl')

    expect(listEnabledAdapters()[0]).toEqual(manifests.elasticsearch)
  })

  it('takes a metadata snapshot when registering an engine', async () => {
    const { listEnabledAdapters } = await registry()
    manifests.elasticsearch.supportedVersions.push('999.x')
    manifests.elasticsearch.capabilities.documentWrite = true

    expect(listEnabledAdapters()[0].supportedVersions).toEqual(['1.x'])
    expect(listEnabledAdapters()[0].capabilities.documentWrite).toBe(false)
  })

  it('coalesces concurrent initialization and caches the resolved instance', async () => {
    const { resolveAdapter, getSearchEngineAdapter } = await registry()
    const first = resolveAdapter('elasticsearch')
    const second = resolveAdapter('elasticsearch')

    expect(first).toBe(second)
    expect(await first).toBe(adapters.elasticsearch)
    expect(await resolveAdapter('elasticsearch')).toBe(adapters.elasticsearch)
    expect(getSearchEngineAdapter).toBe(resolveAdapter)
  })

  it('allows a minimal adapter to omit every unsupported optional operation', async () => {
    const { resolveAdapter } = await registry()
    expect(await resolveAdapter('solr')).toBe(adapters.solr)
    expect(adapters.solr).not.toHaveProperty('listIndices')
    expect(adapters.solr).not.toHaveProperty('getIndexMapping')
  })

  it('rejects an unknown engine with a stable, safe error', async () => {
    const { resolveAdapter } = await registry()
    await expect(resolveAdapter('unknown' as SearchEngineType)).rejects.toMatchObject({
      code: 'unsupported_capability', engineType: 'unknown'
    })
  })

  it('rejects duplicate registration without replacing the existing engine', async () => {
    const { registerBuiltinAdapter, resolveAdapter } = await registry()
    const replacement = vi.fn(() => adapters.solr)

    expect(() => registerBuiltinAdapter(manifests.solr, replacement)).toThrow('already registered')
    expect(await resolveAdapter('solr')).toBe(adapters.solr)
    expect(replacement).not.toHaveBeenCalled()
  })

  it('rejects unsupported manifest versions before accepting a factory', async () => {
    const { registerBuiltinAdapter } = await registry()
    const invalid = { ...manifests.solr, manifestVersion: 2 } as unknown as SearchEngineManifest
    expect(() => registerBuiltinAdapter(invalid, () => adapters.solr)).toThrow('manifest version')
  })

  it('rejects incomplete capability declarations', async () => {
    const { registerBuiltinAdapter } = await registry()
    const invalid = { ...manifests.solr, capabilities: {} } as SearchEngineManifest
    expect(() => registerBuiltinAdapter(invalid, () => adapters.solr)).toThrow('capability')
  })

  it.each(['displayName', 'protocolFamily', 'adapterVersion'] as const)('rejects blank %s identity', async (key) => {
    const { registerBuiltinAdapter } = await registry()
    const invalid = { ...manifests.solr, [key]: ' ' }
    expect(() => registerBuiltinAdapter(invalid, () => adapters.solr)).toThrow('identity')
  })

  it('rejects a factory that returns a different engine identity', async () => {
    adapters.solr.type = 'elasticsearch'
    const { resolveAdapter } = await registry()
    await expect(resolveAdapter('solr')).rejects.toThrow('identity')
  })

  it('rejects mismatches between registered and loaded manifest metadata', async () => {
    const { resolveAdapter } = await registry()
    adapters.solr.manifest = { ...manifests.solr, supportedVersions: ['2.x'] }
    await expect(resolveAdapter('solr')).rejects.toThrow('registered contract')
  })

  it('requires each declared capability to provide its operations', async () => {
    manifests.solr.capabilities.documentQuery = true
    const { resolveAdapter } = await registry()
    await expect(resolveAdapter('solr')).rejects.toThrow('queryDocuments')
  })

  it('accepts a capability when all required operations are present', async () => {
    manifests.solr.capabilities.documentQuery = true
    adapters.solr.queryDocuments = vi.fn()
    const { resolveAdapter } = await registry()
    expect(await resolveAdapter('solr')).toBe(adapters.solr)
  })

  it('evicts a failed instance so corrected initialization can be retried', async () => {
    const validDetect = adapters.solr.detect
    adapters.solr.detect = undefined as unknown as SearchEngineAdapter['detect']
    const { resolveAdapter } = await registry()
    const rejected = resolveAdapter('solr')
    await expect(rejected).rejects.toThrow('detect')

    adapters.solr.detect = validDetect
    const retried = resolveAdapter('solr')
    expect(retried).not.toBe(rejected)
    expect(await retried).toBe(adapters.solr)
  })
})
