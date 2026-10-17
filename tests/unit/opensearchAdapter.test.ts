import { afterEach, describe, expect, it, vi } from 'vitest'
import { opensearchAdapter, opensearchManifest, parseOpenSearchInfo, detect, testConnection } from '../../src/main/adapters/opensearch'
import type { SearchConnection } from '../../src/shared/searchEngine'
import { invalidateServerInfoCache } from '../../src/main/search/serverVersionCache'

const connection: SearchConnection = {id: 'opensearch-fixture', name: 'fixture', engineType: 'opensearch', url: 'http://localhost:9200', authType: 'none', createdAt: '', updatedAt: ''}
afterEach(() => vi.unstubAllGlobals())

describe('OpenSearch 1/2 contract', () => {
  it.each(['1.3.20', '2.19.1'])('keeps independent version identity for %s', version => {
    expect(parseOpenSearchInfo({version: {number: version, distribution: 'opensearch'}})).toMatchObject({engineType: 'opensearch', version, compatibleRange: '1.x-2.x'})
  })
  it('rejects Elasticsearch and unsupported OpenSearch versions', () => {
    expect(() => parseOpenSearchInfo({version: {number: '8.16.0'}})).toThrow()
    expect(() => parseOpenSearchInfo({version: {number: '3.0.0', distribution: 'opensearch'}})).toThrow()
  })
  it('advertises REST-compatible capabilities without SDK dependencies', () => {
    expect(opensearchManifest).toMatchObject({manifestVersion: 1, adapterVersion: '1.0.0', resourceModel: 'index', queryLanguages: ['elasticsearch-dsl']})
    expect(opensearchAdapter.getCapabilities()).toMatchObject({documentWrite: true, mappings: true, importExport: true})
    expect(opensearchAdapter.createDocument).toBeTypeOf('function')
  })
  it('detects a root fixture and tests a named cluster', async () => {
    const body = JSON.stringify({cluster_name: 'fixture-cluster', version: {number: '2.19.1', distribution: 'opensearch'}})
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(body, {status: 200})))
    vi.stubGlobal('fetch', fetch)
    expect(await detect(connection)).toMatchObject({engineType: 'opensearch', major: 2})
    expect(await testConnection(connection)).toMatchObject({reachable: true, clusterName: 'fixture-cluster', version: '2.19.1'})
  })
  it.each(['1.3.20', '2.19.1'])('keeps typeless mappings on a cold %s version cache', async version => {
    invalidateServerInfoCache()
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({version: {number: version, distribution: 'opensearch'}})))
      .mockResolvedValueOnce(new Response(JSON.stringify({acknowledged: true})))
    vi.stubGlobal('fetch', fetch)
    await opensearchAdapter.createIndex!({...connection, id: `mapping-${version}`}, {index: 'books', mappings: {properties: {title: {type: 'text'}}}})
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({mappings: {properties: {title: {type: 'text'}}}})
  })
  it.each(['1.3.20', '2.19.1'])('uses composable templates for OpenSearch %s', async version => {
    invalidateServerInfoCache()
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({version: {number: version, distribution: 'opensearch'}})))
      .mockResolvedValueOnce(new Response(JSON.stringify({acknowledged: true})))
    vi.stubGlobal('fetch', fetch)
    await opensearchAdapter.createIndexTemplate!({...connection, id: `template-${version}`}, 'books-template', {index_patterns: ['books-*'], mappings: {properties: {title: {type: 'text'}}}})
    expect(String(fetch.mock.calls[1][0])).toContain('/_index_template/books-template')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({index_patterns: ['books-*'], template: {mappings: {properties: {title: {type: 'text'}}}}})
  })
})
