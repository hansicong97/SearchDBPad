import { afterEach, describe, expect, it, vi } from 'vitest'
import { elasticsearchAdapter } from '../../src/main/adapters/elasticsearch'
import { opensearchAdapter } from '../../src/main/adapters/opensearch'
import type { SearchConnection } from '../../src/shared/searchEngine'

afterEach(() => vi.unstubAllGlobals())

const properties = {
  title: { type: 'text', fields: { keyword: { type: 'keyword' } } },
  author: { properties: { name: { type: 'keyword' } } },
  comments: { type: 'nested', properties: {
    message: { type: 'text' },
    replies: { type: 'nested', properties: { body: { type: 'text' } } }
  } }
}

describe('Elasticsearch/OpenSearch generic schema', () => {
  it.each([
    ['Elasticsearch 6', elasticsearchAdapter, { books: { mappings: { article: { properties }, review: { properties: { score: { type: 'integer' } } } } } }],
    ['Elasticsearch 7-9', elasticsearchAdapter, { books: { mappings: { properties } } }],
    ['OpenSearch 1/2', opensearchAdapter, { books: { mappings: { properties } } }]
  ] as const)('keeps recursive paths, nested ancestry and multi-fields for %s', async (_name, adapter, raw) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(raw))))
    const connection = { id: 'schema-fixture', engineType: adapter.type, url: 'http://localhost:9200', authType: 'none' } as SearchConnection
    const result = await adapter.getSchema!(connection, 'books')
    expect(result.raw).toEqual(raw)
    expect(result.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'title', type: 'text' }),
      expect.objectContaining({ name: 'title.keyword', type: 'keyword', metadata: expect.objectContaining({ multiFieldOf: 'title' }) }),
      expect.objectContaining({ name: 'author', type: 'object' }),
      expect.objectContaining({ name: 'author.name', type: 'keyword' }),
      expect.objectContaining({ name: 'comments.message', metadata: expect.objectContaining({ nestedPaths: ['comments'] }) }),
      expect.objectContaining({ name: 'comments.replies.body', metadata: expect.objectContaining({ nestedPaths: ['comments', 'comments.replies'] }) })
    ]))
    if (_name === 'Elasticsearch 6') expect(result.fields).toContainEqual(expect.objectContaining({ name: 'score', type: 'integer', metadata: expect.objectContaining({ mappingType: 'review' }) }))
  })

  it('reads an alias response keyed by its concrete backing index', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ 'books-000001': { mappings: { properties } } }))))
    const result = await elasticsearchAdapter.getSchema!({ id: 'alias-fixture', url: 'http://localhost:9200', engineType: 'elasticsearch', authType: 'none' } as SearchConnection, 'books')
    expect(result.fields.map(field => field.name)).toContain('title.keyword')
  })
})
