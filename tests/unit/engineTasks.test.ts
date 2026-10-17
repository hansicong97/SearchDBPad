import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTask, getTask, cancelTask } from '../../src/main/adapters/elasticsearch/taskApi'
import { setCachedServerInfo } from '../../src/main/search/serverVersionCache'
import type { SearchConnection, SearchEngineServerInfo } from '../../src/shared/searchEngine'

const connection: SearchConnection = {id: 'task-fixture', name: 'fixture', engineType: 'elasticsearch', url: 'http://localhost:9200', authType: 'none', createdAt: '', updatedAt: ''}
function mockResponse(body: unknown) {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), {status: 200})))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
afterEach(() => vi.unstubAllGlobals())

describe('Elasticsearch/OpenSearch task contract', () => {
  it.each(['updateByQuery', 'deleteByQuery'] as const)('starts asynchronous %s on one explicit resource', async operation => {
    const fetch = mockResponse({task: 'node-1:42'})
    expect(await executeTask(connection, {resourceName: 'books', operation, body: {query: {match_all: {}}}})).toEqual({connectionId: connection.id, taskId: 'node-1:42', completed: false})
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.pathname).toBe('/books/' + (operation === 'updateByQuery' ? '_update_by_query' : '_delete_by_query'))
    expect(url.searchParams.get('wait_for_completion')).toBe('false')
    expect(url.searchParams.get('refresh')).toBe('false')
  })
  it('reindexes only from the chosen resource into a different explicit target', async () => {
    const fetch = mockResponse({task: 'node-1:42'})
    const body = {source: {query: {match_all: {}}}, dest: {index: 'books-new', op_type: 'create'}}
    await executeTask(connection, {resourceName: 'books', operation: 'reindex', body})
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({...body, source: {...body.source, index: 'books'}})
    expect(body.source).not.toHaveProperty('index')
  })
  it.each([6, 7, 8, 9, 101, 102])('normalizes total document limits for version fixture %s', async fixture => {
    const engineType = fixture >= 100 ? 'opensearch' : 'elasticsearch'
    const major = fixture >= 100 ? fixture - 100 : fixture
    const conn = {...connection, id: `limit-${fixture}`, engineType} as SearchConnection
    setCachedServerInfo(conn.id, {engineType, engineName: engineType, major, minor: 0, patch: 0, version: `${major}.0.0`} as SearchEngineServerInfo)
    const fetch = mockResponse({task: 'node-1:42'})
    await executeTask(conn, {resourceName: 'books', operation: 'deleteByQuery', body: {query: {match_all: {}}, max_docs: 25}})
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.searchParams.get(fixture === 6 ? 'size' : 'max_docs')).toBe('25')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({query: {match_all: {}}})
  })
  it('rejects broad targets, hidden fields and remote reindex before requests', async () => {
    const fetch = mockResponse({})
    for (const resourceName of ['*', '_all', 'books,other', '..', 'books/path']) {
      await expect(executeTask(connection, {resourceName, operation: 'deleteByQuery', body: {query: {match_all: {}}}})).rejects.toThrow()
    }
    await expect(executeTask(connection, {resourceName: 'books', operation: 'reindex', body: {source: {index: 'books', remote: {host: 'http://other', password: 'secret'}}, dest: {index: 'other'}}})).rejects.toThrow()
    await expect(executeTask(connection, {resourceName: 'books', operation: 'reindex', body: {source: {index: 'other'}, dest: {index: 'target'}}})).rejects.toThrow()
    await expect(executeTask(connection, {resourceName: 'books', operation: 'reindex', body: {source: {}, dest: {index: 'books'}}})).rejects.toThrow()
    await expect(executeTask(connection, {resourceName: 'books', operation: 'deleteByQuery', body: {}})).rejects.toThrow()
    await expect(executeTask(connection, {resourceName: 'books', operation: 'updateByQuery', body: {query: {}, script: 'unsafe'}})).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('maps running status to safe progress counters', async () => {
    mockResponse({completed: false, task: {status: {total: 100, updated: 25, secret: 'hidden'}, headers: {Authorization: 'secret'}}})
    expect(await getTask(connection, 'node-1:42')).toMatchObject({completed: false, response: {total: 100, updated: 25}})
    expect(JSON.stringify(await getTask(connection, 'node-1:42'))).not.toContain('secret')
  })
  it('summarizes completed failures without exposing scripts or credentials', async () => {
    mockResponse({completed: true, response: {total: 2, updated: 1, failures: [{cause: 'password=secret'}]}, error: {reason: 'Authorization: secret'}})
    const result = await getTask(connection, 'node-1:42')
    expect(result).toMatchObject({completed: true, response: {total: 2, updated: 1, failureCount: 1}})
    expect(result.error).toBeTruthy()
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('requests cooperative cancellation without claiming completion', async () => {
    const fetch = mockResponse({nodes: {node: {tasks: {'node-1:42': {cancelled: true}}}}})
    expect(await cancelTask(connection, 'node-1:42')).toEqual({connectionId: connection.id, taskId: 'node-1:42', completed: false, cancelled: true})
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/_tasks/node-1%3A42/_cancel')
  })
  it('rejects invalid task IDs and malformed asynchronous responses', async () => {
    const fetch = mockResponse({completed: true})
    await expect(cancelTask(connection, '../_cancel')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    await expect(executeTask(connection, {resourceName: 'books', operation: 'deleteByQuery', body: {query: {match_all: {}}}})).rejects.toMatchObject({code: 'parse_error'})
  })
})
