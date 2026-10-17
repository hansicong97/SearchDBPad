import { describe, expect, it } from 'vitest'
import { SearchEngineError, toPublicSearchError } from '../../src/main/search/errors'

describe('public search error mapping', () => {
  it.each([
    [400, 'invalid_request'],
    [401, 'auth_failed'],
    [404, 'resource_not_found'],
    [409, 'conflict'],
    [413, 'payload_too_large'],
    [429, 'rate_limited'],
    [504, 'timeout']
  ])('maps HTTP %s to stable code %s', (status, code) => {
    const result = toPublicSearchError(new SearchEngineError({
      engineType: 'elasticsearch',
      status,
      code: 'http_error',
      message: `server response for https://user:secret@example.test:9200 (Authorization: Bearer token)` ,
      details: { error: { reason: 'secret response body' } }
    }), 'document:search')

    expect(result).toMatchObject({ code, operation: 'document:search' })
    expect(JSON.stringify(result)).not.toMatch(/secret|Authorization|Bearer|example\.test|response body/)
  })

  it('preserves cancellation without exposing the underlying message', () => {
    const error = new Error('aborted request https://user:secret@example.test')
    error.name = 'AbortError'

    expect(toPublicSearchError(error, 'export:run')).toEqual({
      code: 'cancelled',
      operation: 'export:run',
      message: '请求已取消'
    })
  })

  it('maps unknown failures to a generic actionable response', () => {
    const result = toPublicSearchError(
      new Error('socket failed for http://admin:password@example.test'),
      'connection:test'
    )

    expect(result).toEqual({
      code: 'operation_failed',
      operation: 'connection:test',
      message: '操作失败，请检查请求和服务器状态后重试'
    })
  })
})
