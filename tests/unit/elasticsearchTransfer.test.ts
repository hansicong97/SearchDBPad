import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchConnection } from '../../src/shared/searchEngine'
import { runWithRequestContext, getCurrentRequestSignal } from '../../src/main/search/requestContext'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/adapters/elasticsearch/client', () => ({ elasticsearchRequest: request }))
import { exportBatches } from '../../src/main/adapters/elasticsearch/exportApi'
import { importDocuments } from '../../src/main/adapters/elasticsearch/importApi'

const connection = { id: 'test', engineType: 'elasticsearch' } as SearchConnection
beforeEach(() => { request.mockReset() })

describe('Elasticsearch transfer pagination and cleanup', () => {
  it('bounds pages, respects the requested row limit, and clears the latest scroll id', async () => {
    request.mockResolvedValueOnce({ _scroll_id: 'first', hits: { hits: [{ _id: '1', _source: { n: 1 } }] } })
      .mockResolvedValueOnce({ _scroll_id: 'second', hits: { hits: [{ _id: '2', _source: { n: 2 } }, { _id: '3', _source: { n: 3 } }] } })
      .mockResolvedValueOnce({})
    const batches = []
    for await (const batch of exportBatches(connection, { index: 'my docs', maxRows: 2 })) batches.push(batch)
    expect(batches.map((batch) => batch.map((hit) => hit.id))).toEqual([['1'], ['2']])
    expect(request.mock.calls[0][1]).toMatchObject({ path: '/my%20docs/_search', query: { scroll: '1m' }, body: { size: 2, sort: ['_doc'] } })
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'POST', path: '/_search/scroll', body: { scroll_id: 'first' } })
    expect(request.mock.calls[2][1]).toMatchObject({ method: 'DELETE', body: { scroll_id: ['second'] } })
  })

  it('releases the scroll outside cancelled request context', async () => {
    const controller = new AbortController()
    let cleanupSignal: AbortSignal | undefined
    request.mockImplementation(async (_connection, options) => {
      if (options.method === 'DELETE') { cleanupSignal = getCurrentRequestSignal(); return {} }
      return { _scroll_id: 'active', hits: { hits: [{ _id: '1', _source: {} }] } }
    })
    await expect(runWithRequestContext({ signal: controller.signal }, async () => {
      for await (const _batch of exportBatches(connection, { index: 'docs', maxRows: 10, signal: controller.signal })) controller.abort()
    })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'DELETE', path: '/_search/scroll' })
    expect(request.mock.calls[1][1].signal).toBeUndefined()
    expect(cleanupSignal).toBeUndefined()
  })

  it('releases the scroll when a consumer stops after the first batch', async () => {
    request.mockResolvedValueOnce({ _scroll_id: 'active', hits: { hits: [{ _source: { n: 1 } }] } }).mockResolvedValueOnce({})
    for await (const _batch of exportBatches(connection, { index: 'docs', maxRows: 5000 })) break
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0][1].body.size).toBe(1000)
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'DELETE', body: { scroll_id: ['active'] } })
  })

  it('counts missing bulk response items as failures and forwards cancellation', async () => {
    const controller = new AbortController()
    request.mockResolvedValueOnce({ items: [{ index: { _id: '1', status: 201 } }] }).mockResolvedValueOnce({})
    const result = await importDocuments(connection, { index: 'docs', mode: 'append', signal: controller.signal, rows: [{ id: '1', source: { n: 1 } }, { id: '2', source: { n: 2 } }] })
    expect(result).toMatchObject({ total: 2, success: 1, failed: 1, failures: [{ line: 1, id: '2' }] })
    expect(request.mock.calls.map(([, options]) => options.signal)).toEqual([controller.signal, controller.signal])
  })

  it('stops replace import when delete-by-query only partially clears the index', async () => {
    request.mockResolvedValueOnce({ total: 3, deleted: 2, timed_out: false, version_conflicts: 0, failures: [] })

    await expect(importDocuments(connection, {
      index: 'my docs',
      mode: 'replace',
      rows: [{ id: '1', source: { n: 1 } }]
    })).rejects.toMatchObject({ code: 'http_error' })

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1]).toMatchObject({
      path: '/my%20docs/_delete_by_query',
      query: { refresh: 'true', conflicts: 'abort' }
    })
  })

  it('rejects timed-out export pages instead of writing incomplete results', async () => {
    request.mockResolvedValueOnce({
      _scroll_id: 'timed-out',
      timed_out: true,
      hits: { hits: [{ _id: '1', _source: { n: 1 } }] }
    }).mockResolvedValueOnce({})

    const consume = async (): Promise<void> => {
      for await (const _batch of exportBatches(connection, { index: 'docs', maxRows: 10 })) {
        // The first page should fail validation before yielding.
      }
    }
    await expect(consume()).rejects.toMatchObject({ code: 'http_error' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'DELETE', body: { scroll_id: ['timed-out'] } })
  })
})
