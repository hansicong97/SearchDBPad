import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSolrUrl } from '../../src/main/adapters/solr/client'
import { solrAdapter, solrManifest, parseSolrInfo, buildSolrQuery, listResources, queryDocuments, createDocument, updateDocument, deleteDocument, importDocuments, exportBatches } from '../../src/main/adapters/solr'
import type { SearchConnection } from '../../src/shared/searchEngine'

const connection: SearchConnection = {id: 'solr-fixture', name: 'fixture', engineType: 'solr', url: 'http://localhost:8983/solr', authType: 'none', createdAt: '', updatedAt: ''}
const schema = {schema: {uniqueKey: 'sku', fields: [{name: 'sku', type: 'string', required: true}, {name: 'title', type: 'text_general', stored: true}]}}
function mockResponses(...responses: Array<unknown | Response>) {
  const fetch = vi.fn()
  for (const response of responses) fetch.mockResolvedValueOnce(response instanceof Response ? response : new Response(JSON.stringify(response), {status: 200}))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
afterEach(() => vi.unstubAllGlobals())

describe('Solr 8/9 contract', () => {
  it.each(['8.11.4', '9.8.0'])('detects %s without ES assumptions', version => {
    expect(parseSolrInfo({lucene: {'solr-spec-version': version}, mode: 'solrcloud'})).toMatchObject({engineType: 'solr', version})
  })
  it('rejects an unsupported server and advertises only implemented capabilities', () => {
    expect(() => parseSolrInfo({lucene: {'solr-spec-version': '7.7.3'}})).toThrow()
    expect(solrManifest.transferFormats).toEqual(['json', 'csv'])
    expect(solrAdapter.getCapabilities()).toMatchObject({documentWrite: true, mappings: false, tasks: false, dslQuery: false})
    expect(solrAdapter.getIndexMapping).toBeUndefined()
  })
  it('preserves a proxy prefix, encodes a resource and repeats fq', () => {
    const url = new URL(buildSolrUrl('http://localhost:8983/proxy/solr/', {path: '/books/select', query: {fq: ['tag:a', 'price:[1 TO 2]']}}))
    expect(url.pathname).toBe('/proxy/solr/books/select')
    expect(url.searchParams.getAll('fq')).toEqual(['tag:a', 'price:[1 TO 2]'])
    expect(url.searchParams.get('wt')).toBe('json')
  })
  it('normalizes only native Solr parameters and rejects invalid pagination/DSL', () => {
    expect(buildSolrQuery({q: 'title:book', fq: ['active:true'], rows: 25})).toEqual({q: 'title:book', fq: ['active:true'], start: 0, rows: 25})
    expect(() => buildSolrQuery({query: {match_all: {}}})).toThrow()
    expect(() => buildSolrQuery({rows: -1})).toThrow()
    expect(() => buildSolrQuery({rows: 10001})).toThrow()
  })
  it('lists cloud collections and falls back to cores only on standalone status', async () => {
    const fetch = mockResponses({collections: ['z', 'a']}, new Response('{}', {status: 400}), {status: {books: {name: 'books', index: {numDocs: 7}}}})
    expect(await listResources(connection)).toEqual([{name: 'a', kind: 'collection'}, {name: 'z', kind: 'collection'}])
    expect(await listResources(connection)).toEqual([{name: 'books', kind: 'core', documentCount: 7}])
    expect(String(fetch.mock.calls[2][0])).toContain('/admin/cores?')
  })
  it('does not conceal authentication failures behind a cores fallback', async () => {
    const fetch = mockResponses(new Response('{}', {status: 401}))
    await expect(listResources(connection)).rejects.toMatchObject({code: 'auth_failed'})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('queries native Solr and maps a non-id uniqueKey into neutral hits', async () => {
    const fetch = mockResponses(schema, {responseHeader: {QTime: 2}, response: {numFound: 1, docs: [{sku: 'b-1', title: 'Book'}]}})
    const result = await queryDocuments({...connection, id: 'query-fixture'}, {resourceName: 'books', queryLanguage: 'solr', query: {q: '*:*', fq: ['active:true']}, requestSeq: 7})
    expect(result).toMatchObject({resourceName: 'books', requestSeq: 7, total: 1, hits: [{id: 'b-1', fields: {sku: 'b-1', title: 'Book'}}]})
    expect(result.hits[0]).not.toHaveProperty('_source')
    expect(String(fetch.mock.calls[1][0])).toContain('/books/select?')
  })
  it('writes, edits and deletes using schema uniqueKey and selected commit policy', async () => {
    const fetch = mockResponses(schema, {responseHeader: {status: 0}}, {responseHeader: {status: 0}}, {responseHeader: {status: 0}})
    const conn = {...connection, id: 'write-fixture'}
    expect(await createDocument(conn, {index: 'books', id: 'b-1', source: {title: 'Book'}, commitPolicy: 'softCommit'})).toMatchObject({id: 'b-1', result: 'created'})
    await updateDocument(conn, {index: 'books', id: 'b-1', source: {sku: 'b-1', title: 'Edited', _version_: 123}, commitPolicy: 'commit'})
    await deleteDocument(conn, {index: 'books', id: 'b-1', commitPolicy: 'none'})
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({add: {doc: {title: 'Book', sku: 'b-1'}, overwrite: true}})
    expect(String(fetch.mock.calls[1][0])).toContain('softCommit=true')
    expect(String(fetch.mock.calls[2][0])).toContain('commit=true')
    expect(JSON.parse(fetch.mock.calls[2][1].body).add.doc).not.toHaveProperty('_version_')
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({delete: {id: 'b-1'}})
  })
  it('rejects conflicting uniqueKey before sending a mutation', async () => {
    const fetch = mockResponses(schema)
    await expect(createDocument({...connection, id: 'conflict-fixture'}, {index: 'books', id: 'a', source: {sku: 'b'}})).rejects.toThrow('uniqueKey')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('imports bounded batches and summarizes invalid uniqueKeys', async () => {
    const fetch = mockResponses(schema, {responseHeader: {status: 0}}, {responseHeader: {status: 0}}, {responseHeader: {status: 0}})
    const rows = Array.from({length: 501}, (_, i) => ({source: {sku: `b-${i}`}}))
    rows.push({source: {} as {sku: string}})
    const result = await importDocuments({...connection, id: 'import-fixture'}, {index: 'books', rows, mode: 'append', commitPolicy: 'commit'})
    expect(result).toMatchObject({total: 502, success: 501, failed: 1})
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toHaveLength(500)
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toHaveLength(1)
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({commit: {}})
  })
  it('exports cursor batches with uniqueKey sort and preserves backpressure', async () => {
    const fetch = mockResponses(schema, {response: {numFound: 2, docs: [{sku: 'a'}]}, nextCursorMark: 'next'}, {response: {numFound: 2, docs: [{sku: 'b'}]}, nextCursorMark: 'next'})
    const iterator = exportBatches({...connection, id: 'export-fixture'}, {index: 'books', maxRows: 1000})
    expect((await iterator.next()).value).toMatchObject([{id: 'a'}])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect((await iterator.next()).value).toMatchObject([{id: 'b'}])
    expect((await iterator.next()).done).toBe(true)
    const url = new URL(String(fetch.mock.calls[1][0]))
    expect(url.searchParams.get('sort')).toBe('sku asc')
    expect(url.searchParams.get('cursorMark')).toBe('*')
  })
  it('does not send an import after cancellation', async () => {
    const fetch = mockResponses()
    await expect(importDocuments(connection, {index: 'books', rows: [{source: {sku: 'x'}}], mode: 'append', isCancelled: () => true})).rejects.toMatchObject({name: 'AbortError'})
    expect(fetch).not.toHaveBeenCalled()
  })
  it('propagates schema authentication failure before a replace mutation', async () => {
    const fetch = mockResponses(new Response('{}', {status: 401}))
    await expect(importDocuments({...connection, id: 'replace-auth'}, {index: 'books', rows: [{source: {sku: 'a'}}], mode: 'replace'})).rejects.toMatchObject({code: 'auth_failed'})
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0][0])).toContain('/schema?')
  })
  it('does not erase a resource when every replacement row is invalid', async () => {
    const fetch = mockResponses(schema)
    expect(await importDocuments({...connection, id: 'invalid-replace'}, {index: 'books', rows: [{source: {}}], mode: 'replace'})).toMatchObject({success: 0, failed: 1})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('defers replace deletion until a later batch contains a valid row', async () => {
    const fetch = mockResponses(schema, {responseHeader: {status: 0}}, {responseHeader: {status: 0}})
    const rows = Array.from({length: 500}, () => ({source: {}} as {source: {sku?: string}}))
    rows.push({source: {sku: 'valid'}})

    const result = await importDocuments({...connection, id: 'late-valid-replace'}, {
      index: 'books', rows, mode: 'replace'
    })

    expect(result).toMatchObject({success: 1, failed: 500})
    expect(result.failures[0]).toMatchObject({line: 0})
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({delete: {query: '*:*'}})
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual([{sku: 'valid'}])
  })
  it('cancels a schema request before issuing the document query', async () => {
    const controller = new AbortController()
    const fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true})
    }))
    vi.stubGlobal('fetch', fetch)
    const pending = queryDocuments({...connection, id: 'query-cancel'}, {resourceName: 'books', queryLanguage: 'solr', query: {}, signal: controller.signal})
    controller.abort()
    await expect(pending).rejects.toMatchObject({name: 'AbortError'})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('keeps requested export sort and adds the uniqueKey cursor tiebreaker', async () => {
    const fetch = mockResponses(schema, {response: {numFound: 1, docs: [{sku: 'a'}]}, nextCursorMark: 'end'})
    for await (const _batch of exportBatches({...connection, id: 'sorted-export'}, {index: 'books', maxRows: 1, query: {sort: 'title desc'}})) { /* drain */ }
    expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get('sort')).toBe('title desc,sku asc')
  })
  it('rejects non-native export language and invalid resources before network IO', async () => {
    const fetch = mockResponses()
    await expect(exportBatches(connection, {index: 'books', maxRows: 10, queryLanguage: 'elasticsearch-dsl'}).next()).rejects.toThrow()
    await expect(queryDocuments(connection, {resourceName: '..', queryLanguage: 'solr', query: {}})).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
