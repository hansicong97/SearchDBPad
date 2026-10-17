import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchConnection } from '../../src/shared/searchEngine'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/adapters/elasticsearch/client', () => ({ elasticsearchRequest: request }))

import {
  createDocument,
  searchDocuments,
  updateDocument,
  deleteDocument
} from '../../src/main/adapters/elasticsearch/documentApi'
import { addAlias, deleteAlias } from '../../src/main/adapters/elasticsearch/aliasApi'

const connection = { id: 'fixture', engineType: 'elasticsearch' } as SearchConnection

beforeEach(() => request.mockReset())

describe('Elasticsearch resource URL path encoding', () => {
  it('keeps an index name in one segment for search and document writes', async () => {
    request.mockResolvedValue({ hits: { hits: [] } })
    const index = 'tenant/docs?private#part'

    await searchDocuments(connection, { index, query: { query: { match_all: {} } } })
    await createDocument(connection, { index, source: { ok: true } })
    await updateDocument(connection, { index, id: 'doc/1?x#y', source: { ok: true } })
    await deleteDocument(connection, { index, id: 'doc/1?x#y' })

    expect(request.mock.calls.map(([, options]) => options.path)).toEqual([
      '/tenant%2Fdocs%3Fprivate%23part/_search',
      '/tenant%2Fdocs%3Fprivate%23part/_doc',
      '/tenant%2Fdocs%3Fprivate%23part/_doc/doc%2F1%3Fx%23y',
      '/tenant%2Fdocs%3Fprivate%23part/_doc/doc%2F1%3Fx%23y'
    ])
  })

  it('keeps index and alias names in one segment for alias changes', async () => {
    request.mockResolvedValue({})
    const index = 'tenant/docs?private#part'
    const alias = 'read/current?x#y'

    await addAlias(connection, index, alias)
    await deleteAlias(connection, index, alias)

    expect(request.mock.calls.map(([, options]) => options.path)).toEqual([
      '/tenant%2Fdocs%3Fprivate%23part/_alias/read%2Fcurrent%3Fx%23y',
      '/tenant%2Fdocs%3Fprivate%23part/_alias/read%2Fcurrent%3Fx%23y'
    ])
  })

  it.each(['.', '..'])('rejects bare dot index path segment %s', async index => {
    await expect(searchDocuments(connection, { index, query: {} })).rejects.toThrow('Invalid index name')
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['.', '..'])('rejects bare dot alias path segment %s', async name => {
    await expect(addAlias(connection, 'docs', name)).rejects.toThrow('Invalid index or alias name')
    await expect(addAlias(connection, name, 'current')).rejects.toThrow('Invalid index or alias name')
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['.', '..'])('rejects document ID %s before a URL can normalize its target', async id => {
    await expect(createDocument(connection, { index: 'books', id, source: {} })).rejects.toThrow()
    await expect(updateDocument(connection, { index: 'books', id, source: {} })).rejects.toThrow()
    await expect(deleteDocument(connection, { index: 'books', id })).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
