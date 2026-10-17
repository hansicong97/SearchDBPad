import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchConnection, SearchEngineServerInfo } from '../../src/shared/searchEngine'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/adapters/elasticsearch/client', () => ({ elasticsearchRequest: request }))

import { detect } from '../../src/main/adapters/elasticsearch/detector'
import {
  normalizeCreateIndexBodyForEsVersion,
  normalizeUpdateMappingBodyForEsVersion
} from '../../src/main/adapters/elasticsearch/versionCompat'
import { elasticsearchAdapter } from '../../src/main/adapters/elasticsearch'
import { setCachedServerInfo } from '../../src/main/search/serverVersionCache'

const connection: SearchConnection = {
  id: 'fixture',
  name: 'Fixture connection',
  engineType: 'elasticsearch',
  url: 'http://localhost:9200',
  authType: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function info(major: number): SearchEngineServerInfo {
  return {
    engineType: 'elasticsearch',
    engineName: 'Elasticsearch',
    version: `${major}.0.0`,
    major,
    minor: 0,
    patch: 0,
    compatibleRange: '6.x-9.x'
  }
}

beforeEach(() => {
  request.mockReset()
})

describe('Elasticsearch supported-version fixtures', () => {
  it.each([
    ['6.8.23', 6, 8, 23],
    ['7.17.24', 7, 17, 24],
    ['8.15.3', 8, 15, 3],
    ['9.0.0', 9, 0, 0]
  ])('detects Elasticsearch %s', async (version, major, minor, patch) => {
    request.mockResolvedValue({
      cluster_name: 'fixture-cluster',
      version: { number: version, build_flavor: 'default' }
    })

    expect(await detect(connection)).toEqual({
      engineType: 'elasticsearch',
      engineName: 'Elasticsearch',
      version,
      major,
      minor,
      patch,
      distribution: 'default',
      compatibleRange: '6.x-9.x'
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(connection, { method: 'GET', path: '/' })
  })

  it('passes through authentication failures from transport', async () => {
    const failure = new Error('Authentication failed')
    request.mockRejectedValue(failure)
    await expect(detect(connection)).rejects.toBe(failure)
  })

  it.each([
    {number: '5.6.16', distribution: 'default'},
    {number: '10.0.0', distribution: 'default'},
    {number: '2.19.1', distribution: 'opensearch'},
    {number: 'not-a-version', distribution: 'default'}
  ])('rejects unsupported or malformed root version %#', async version => {
    request.mockResolvedValue({version})
    await expect(detect(connection)).rejects.toMatchObject({code: 'unsupported_capability'})
  })
})

describe('Elasticsearch request-shape compatibility', () => {
  const properties = { title: { type: 'text' } }

  it('wraps typeless mappings under _doc for ES 6 create', () => {
    expect(normalizeCreateIndexBodyForEsVersion({ mappings: { properties } }, info(6)))
      .toEqual({ mappings: { _doc: { properties } } })
  })

  it('does not wrap an already typed ES 6 create body twice', () => {
    const body = { mappings: { _doc: { properties } } }
    expect(normalizeCreateIndexBodyForEsVersion(body, info(6))).toBe(body)
  })

  it.each([7, 8, 9])('retains typeless create mappings for ES %i', (major) => {
    const body = { settings: { number_of_shards: 1 }, mappings: { properties } }
    expect(normalizeCreateIndexBodyForEsVersion(body, info(major))).toEqual(body)
    expect(body.mappings).not.toHaveProperty('_doc')
  })

  it('wraps ES 6 mapping updates and preserves already wrapped bodies', () => {
    expect(normalizeUpdateMappingBodyForEsVersion({ properties }, info(6)))
      .toEqual({ _doc: { properties } })
    const wrapped = { _doc: { properties } }
    expect(normalizeUpdateMappingBodyForEsVersion(wrapped, info(6))).toBe(wrapped)
  })

  it.each([7, 8, 9])('retains typeless mapping updates for ES %i', (major) => {
    const body = { properties }
    expect(normalizeUpdateMappingBodyForEsVersion(body, info(major))).toBe(body)
  })
})

describe('Elasticsearch version capabilities', () => {
  it('publishes detected feature flags instead of a static version claim', async () => {
    const detected = info(6)
    setCachedServerInfo(connection.id, detected)
    const capabilities = await elasticsearchAdapter.getCapabilities(connection)
    expect(capabilities.versionFeatures).toMatchObject({
      requiresDocTypeForMapping: true,
      supportsTypelessDocumentApi: false,
      supportsRuntimeFields: false
    })

    setCachedServerInfo(connection.id, info(8))
    const modern = await elasticsearchAdapter.getCapabilities(connection)
    expect(modern.versionFeatures).toMatchObject({
      requiresDocTypeForMapping: false,
      supportsTypelessDocumentApi: true,
      supportsRuntimeFields: true
    })
  })
})
