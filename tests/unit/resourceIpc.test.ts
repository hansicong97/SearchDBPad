import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestCancelRequest, SearchQueryRequest } from '../../src/shared/ipc'
import { getCurrentRequestSignal } from '../../src/main/search/requestContext'
import { toPublicSearchError } from '../../src/main/search/errors'

const mocks = vi.hoisted(() => ({ queryResource: vi.fn() }))

vi.mock('../../src/main/services/resource.service', () => ({
  queryResource: mocks.queryResource,
  safeFailure: (error: unknown, operation: string) => ({ success: false, error: toPublicSearchError(error, operation) })
}))

import { handleResourceQuery, handleRequestCancel } from '../../src/main/services/resourceIpc.service'

const request: SearchQueryRequest = {
  connectionId: 'conn-1', resourceName: 'books', requestSeq: 7,
  queryLanguage: 'elasticsearch-dsl', query: { query: { match_all: {} } }
}

describe('resource IPC cancellation boundary', () => {
  beforeEach(() => { mocks.queryResource.mockReset() })

  it.each([null, undefined, [], { ...request, requestSeq: -1 }, { ...request, requestSeq: '7' },
    { ...request, requestSeq: null }, { ...request, requestSeq: Number.MAX_SAFE_INTEGER + 1 }
  ])('wraps an invalid query context in a safe envelope: %j', async invalid => {
    const result = await handleResourceQuery(101, invalid as SearchQueryRequest)
    expect(result).toEqual({ success: false, error: {
      code: 'invalid_request', operation: 'resources.query', message: '请求参数无效，请检查输入'
    } })
    expect(mocks.queryResource).not.toHaveBeenCalled()
  })

  it.each([null, undefined, [], { ...request, requestSeq: -1 }, { ...request, requestSeq: '7' },
    { ...request, requestSeq: null }, { ...request, resourceName: {} }
  ])('wraps an invalid cancellation context in a safe envelope: %j', invalid => {
    expect(handleRequestCancel(101, invalid as RequestCancelRequest)).toEqual({ success: false, error: {
      code: 'invalid_request', operation: 'requests.cancel', message: '请求参数无效，请检查输入'
    } })
  })

  it('cancels only the matching sender request and cleans up on completion', async () => {
    let signal: AbortSignal | undefined
    mocks.queryResource.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      signal = getCurrentRequestSignal()
      signal?.addEventListener('abort', () => {
        const error = new Error('secret http://username:password@example.test')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }))

    const pending = handleResourceQuery(102, request)
    expect(signal?.aborted).toBe(false)
    expect(handleRequestCancel(103, request)).toEqual({ success: true, data: { cancelled: false } })
    expect(signal?.aborted).toBe(false)
    expect(handleRequestCancel(102, request)).toEqual({ success: true, data: { cancelled: true } })
    expect(signal?.aborted).toBe(true)
    expect(await pending).toEqual({ success: false, error: {
      code: 'cancelled', operation: 'resources.query', message: '请求已取消'
    } })
    expect(handleRequestCancel(102, request)).toEqual({ success: true, data: { cancelled: false } })
  })

  it('allows an omitted query sequence and preserves a successful response', async () => {
    const result = { success: true, data: { connectionId: request.connectionId, resourceName: 'books', total: 0, hits: [] } }
    mocks.queryResource.mockResolvedValueOnce(result)
    const { requestSeq: _seq, ...withoutSequence } = request
    expect(await handleResourceQuery(104, withoutSequence)).toBe(result)
    expect(handleRequestCancel(104, { ...request, requestSeq: 0 })).toEqual({ success: true, data: { cancelled: false } })
  })
})
