import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAdapterByConnectionId: vi.fn()
}))

vi.mock('../../src/main/services/searchEngine.service', () => mocks)

import { listIndices, getIndexMapping, refreshIndex } from '../../src/main/services/index.service'
import {
  createDocument,
  deleteDocument,
  searchDocuments,
  updateDocument
} from '../../src/main/services/document.service'
import { SearchEngineError } from '../../src/main/search/errors'
import { emptySearchEngineCapabilities } from '../../src/shared/searchEngine'

const connection = {
  id: 'solr-1', name: 'Solr', engineType: 'solr' as const,
  url: 'http://localhost:8983/solr', authType: 'none' as const,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('legacy IPC services on generic adapters', () => {
  it('does not bypass disabled catalog capability through the legacy list method', async () => {
    const adapter = {
      type: 'elasticsearch',
      displayName: 'Elasticsearch',
      getCapabilities: vi.fn(() => emptySearchEngineCapabilities()),
      listIndices: vi.fn().mockResolvedValue([])
    }
    mocks.resolveAdapterByConnectionId.mockResolvedValueOnce({ connection, adapter })

    expect(await listIndices(connection.id)).toMatchObject({ success: false, error: { code: 'unsupported_capability' } })
    expect(adapter.listIndices).not.toHaveBeenCalled()
  })

  it('does not bypass disabled schema capability through the legacy mapping method', async () => {
    const adapter = {
      type: 'elasticsearch',
      displayName: 'Elasticsearch',
      getCapabilities: vi.fn(() => emptySearchEngineCapabilities()),
      getIndexMapping: vi.fn().mockResolvedValue({})
    }
    mocks.resolveAdapterByConnectionId.mockResolvedValueOnce({ connection, adapter })

    expect(await getIndexMapping(connection.id, 'books')).toMatchObject({ success: false, error: { code: 'unsupported_capability' } })
    expect(adapter.getIndexMapping).not.toHaveBeenCalled()
  })

  it('maps Solr resources through the legacy index:list response', async () => {
    const adapter = {
      type: 'solr' as const,
      displayName: 'Apache Solr',
      manifest: { queryLanguages: ['solr'] },
      listResources: vi.fn().mockResolvedValue([
        { name: 'books', kind: 'collection', documentCount: 12 },
        { name: 'logs', kind: 'core' }
      ])
    }
    mocks.resolveAdapterByConnectionId.mockResolvedValueOnce({ connection, adapter })

    const result = await listIndices(connection.id)

    expect(result).toEqual({
      success: true,
      data: {
        connectionId: connection.id,
        indexCount: 2,
        indices: [
          { index: 'books', health: 'unknown', status: 'unknown', docsCount: 12, docsDeleted: 0, storeSize: 0, pri: 0, rep: 0 },
          { index: 'logs', health: 'unknown', status: 'unknown', docsCount: 0, docsDeleted: 0, storeSize: 0, pri: 0, rep: 0 }
        ]
      }
    })
    expect(adapter.listResources).toHaveBeenCalledWith(connection)
  })

  it('maps Solr schema through the legacy index:mapping response', async () => {
    const schema = {
      connectionId: connection.id,
      resourceName: 'books',
      uniqueKey: 'id',
      fields: [{ name: 'id', type: 'string' }],
      raw: { schema: { uniqueKey: 'id', fields: [{ name: 'id', type: 'string' }] } }
    }
    const adapter = {
      type: 'solr' as const,
      displayName: 'Apache Solr',
      manifest: { queryLanguages: ['solr'] },
      getSchema: vi.fn().mockResolvedValue(schema)
    }
    mocks.resolveAdapterByConnectionId.mockResolvedValueOnce({ connection, adapter })

    const result = await getIndexMapping(connection.id, 'books')

    expect(result).toEqual({
      success: true,
      data: { connectionId: connection.id, index: 'books', mapping: schema.raw }
    })
    expect(adapter.getSchema).toHaveBeenCalledWith(connection, 'books')
  })

  it('routes Solr document:search to queryDocuments with native language', async () => {
    const adapter = {
      type: 'solr' as const,
      displayName: 'Apache Solr',
      manifest: { queryLanguages: ['solr'] },
      queryDocuments: vi.fn().mockResolvedValue({
        connectionId: connection.id,
        resourceName: 'books',
        requestSeq: 3,
        took: 4,
        total: 1,
        totalRelation: 'eq',
        hits: [{ id: '1', fields: { title: 'A' } }],
        raw: { response: { numFound: 1 } }
      })
    }
    mocks.resolveAdapterByConnectionId.mockResolvedValueOnce({ connection, adapter })

    const result = await searchDocuments({
      connectionId: connection.id,
      index: 'books',
      query: { q: 'title:A', rows: 10 }
    })

    expect(adapter.queryDocuments).toHaveBeenCalledWith(connection, {
      resourceName: 'books', queryLanguage: 'solr', query: { q: 'title:A', rows: 10 }
    })
    expect(result).toMatchObject({
      success: true,
      data: {
        connectionId: connection.id,
        index: 'books',
        total: 1,
        hits: [{ id: '1', fields: { title: 'A' } }]
      }
    })
  })

  it('forwards commit policies through document CRUD services', async () => {
    const adapter = {
      type: 'solr' as const,
      displayName: 'Apache Solr',
      manifest: { queryLanguages: ['solr'] },
      createDocument: vi.fn().mockResolvedValue({
        connectionId: connection.id, index: 'books', id: '1', result: 'created', version: 1
      }),
      updateDocument: vi.fn().mockResolvedValue({
        connectionId: connection.id, index: 'books', id: '1', result: 'updated', version: 2
      }),
      deleteDocument: vi.fn().mockResolvedValue({
        connectionId: connection.id, index: 'books', id: '1', result: 'deleted', version: 3
      })
    }
    mocks.resolveAdapterByConnectionId.mockResolvedValue({ connection, adapter })

    await createDocument({
      connectionId: connection.id,
      index: 'books',
      source: { title: 'A' },
      commitPolicy: 'commit'
    })
    await updateDocument({
      connectionId: connection.id,
      index: 'books',
      id: '1',
      source: { title: 'B' },
      commitPolicy: 'softCommit'
    })
    await deleteDocument({
      connectionId: connection.id,
      index: 'books',
      id: '1',
      commitPolicy: 'none'
    })

    expect(adapter.createDocument).toHaveBeenCalledWith(connection, {
      index: 'books', id: undefined, source: { title: 'A' }, commitPolicy: 'commit'
    })
    expect(adapter.updateDocument).toHaveBeenCalledWith(connection, {
      index: 'books', id: '1', source: { title: 'B' }, commitPolicy: 'softCommit'
    })
    expect(adapter.deleteDocument).toHaveBeenCalledWith(connection, {
      index: 'books', id: '1', commitPolicy: 'none'
    })
  })

  it('keeps the commit policy optional for document writes', async () => {
    const adapter = {
      type: 'solr' as const,
      displayName: 'Apache Solr',
      manifest: { queryLanguages: ['solr'] },
      createDocument: vi.fn().mockResolvedValue({
        connectionId: connection.id, index: 'books', id: '1', result: 'created', version: 1
      })
    }
    mocks.resolveAdapterByConnectionId.mockResolvedValueOnce({ connection, adapter })

    await createDocument({
      connectionId: connection.id,
      index: 'books',
      source: { title: 'A' }
    })

    expect(adapter.createDocument).toHaveBeenCalledWith(connection, {
      index: 'books', id: undefined, source: { title: 'A' }, commitPolicy: undefined
    })
  })

  it('returns a safe document error with the exact write operation', async () => {
    const adapter = {
      type: 'elasticsearch' as const,
      displayName: 'Elasticsearch',
      manifest: { queryLanguages: ['elasticsearch-dsl'] },
      createDocument: vi.fn().mockRejectedValue(new SearchEngineError({
        engineType: 'elasticsearch',
        status: 500,
        code: 'http_error',
        message: 'failed at https://elastic:secret@example.test:9200',
        details: { error: { type: 'secret_server_type', reason: 'secret response' } }
      }))
    }
    mocks.resolveAdapterByConnectionId.mockResolvedValueOnce({ connection, adapter })

    const result = await createDocument({
      connectionId: connection.id,
      index: 'books',
      source: { title: 'A' }
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatchObject({ code: 'http_error', operation: 'document:create' })
    expect(JSON.stringify(result)).not.toMatch(/secret|Authorization|example\.test|server_type/)
  })

  it('uses a stable operation for index maintenance errors', async () => {
    const adapter = {
      type: 'elasticsearch' as const,
      displayName: 'Elasticsearch',
      manifest: { queryLanguages: ['elasticsearch-dsl'] },
      refreshIndex: vi.fn().mockRejectedValue(new SearchEngineError({
        engineType: 'elasticsearch',
        status: 503,
        code: 'http_error',
        message: 'maintenance failed at https://elastic:secret@example.test'
      }))
    }
    mocks.resolveAdapterByConnectionId.mockResolvedValueOnce({ connection, adapter })

    const result = await refreshIndex({ connectionId: connection.id, index: 'books' })

    expect(result.success).toBe(false)
    expect(result.error).toMatchObject({ code: 'http_error', operation: 'index:refresh' })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
