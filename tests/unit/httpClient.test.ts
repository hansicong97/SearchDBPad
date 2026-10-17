import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchHttpRequest, type SearchHttpRequestOptions } from '../../src/main/search/httpClient'
import { getCurrentRequestSignal, runWithRequestContext } from '../../src/main/search/requestContext'

const requestOptions: SearchHttpRequestOptions = {
  engineType: 'elasticsearch',
  method: 'GET',
  url: 'http://localhost:9200/_search'
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function response(body: string, overrides: Partial<Response> = {}): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: null,
    text: vi.fn().mockResolvedValue(body),
    ...overrides
  } as Response
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
}

describe('HTTP request cancellation and cleanup', () => {
  it('binds caller cancellation to the in-flight fetch', async () => {
    const caller = new AbortController()
    fetchMock.mockImplementation((_url, init) => rejectWhenAborted(init.signal))
    const result = searchHttpRequest({ ...requestOptions, signal: caller.signal })
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError', code: 'CANCELLED' })

    caller.abort()

    await rejection
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start fetch for an already cancelled request', async () => {
    const caller = new AbortController()
    caller.abort()

    await expect(searchHttpRequest({ ...requestOptions, signal: caller.signal }))
      .rejects.toMatchObject({ code: 'CANCELLED' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels while reading the response body', async () => {
    const caller = new AbortController()
    let bodyStarted!: () => void
    const started = new Promise<void>((resolve) => { bodyStarted = resolve })
    fetchMock.mockImplementation((_url, init) => Promise.resolve(response('', {
      text: () => {
        bodyStarted()
        return rejectWhenAborted(init.signal)
      }
    })))
    const result = searchHttpRequest({ ...requestOptions, signal: caller.signal })
    const rejection = expect(result).rejects.toMatchObject({ code: 'CANCELLED' })
    await started

    caller.abort()

    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a transport timeout separately from user cancellation', async () => {
    fetchMock.mockImplementation((_url, init) => rejectWhenAborted(init.signal))
    const result = searchHttpRequest({ ...requestOptions, timeoutMs: 250 })
    const rejection = expect(result).rejects.toMatchObject({
      name: 'SearchEngineError', code: 'timeout', message: '请求超时'
    })

    await vi.advanceTimersByTimeAsync(250)

    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['success', 'network failure', 'HTTP failure', 'invalid JSON'])
  ('removes abort listeners and the timer after %s', async (outcome) => {
    const caller = new AbortController()
    const addListener = vi.spyOn(caller.signal, 'addEventListener')
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener')
    if (outcome === 'network failure') fetchMock.mockRejectedValue(new Error('offline'))
    else if (outcome === 'HTTP failure') {
      fetchMock.mockResolvedValue(response('denied', { ok: false, status: 403, statusText: 'Forbidden' }))
    } else fetchMock.mockResolvedValue(response(outcome === 'invalid JSON' ? '{invalid' : '{"ok":true}'))

    const result = searchHttpRequest({ ...requestOptions, signal: caller.signal })
    if (outcome === 'success') await expect(result).resolves.toEqual({ ok: true })
    else await expect(result).rejects.toBeInstanceOf(Error)

    expect(addListener).toHaveBeenCalledTimes(1)
    expect(removeListener).toHaveBeenCalledWith('abort', addListener.mock.calls[0][1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('inherits request-context cancellation without passing a signal through each adapter', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation((_url, init) => rejectWhenAborted(init.signal))
    const result = runWithRequestContext({ signal: controller.signal }, () => searchHttpRequest(requestOptions))
    const rejection = expect(result).rejects.toMatchObject({ code: 'CANCELLED' })

    controller.abort()

    await rejection
    expect(getCurrentRequestSignal()).toBeUndefined()
  })

  it('registers only one listener when explicit and inherited signals are identical', async () => {
    const controller = new AbortController()
    const listener = vi.spyOn(controller.signal, 'addEventListener')
    fetchMock.mockResolvedValue(response('{}'))

    await runWithRequestContext({ signal: controller.signal }, () =>
      searchHttpRequest({ ...requestOptions, signal: controller.signal }))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not expose URL credentials or transport details in network errors', async () => {
    const secretUrl = 'http://admin:super-secret@localhost:9200/_search?api_key=secret-key'
    fetchMock.mockRejectedValue(new Error(`Request to ${secretUrl} with Authorization: Bearer secret-token failed`))

    try {
      await searchHttpRequest({ ...requestOptions, url: secretUrl })
      expect.fail('expected network failure')
    } catch (error) {
      expect(error).toMatchObject({ code: 'network_error', message: '网络请求失败' })
      const serialized = JSON.stringify(error)
      expect(serialized).not.toContain('super-secret')
      expect(serialized).not.toContain('secret-key')
      expect(serialized).not.toContain('secret-token')
    }
  })
})

describe('HTTP request formatting', () => {
  it('does not include malformed response content in parse errors', async () => {
    fetchMock.mockResolvedValue(response('secret-token-from-response'))
    await expect(searchHttpRequest(requestOptions)).rejects.toMatchObject({ code: 'parse_error', message: '响应解析失败', details: { method: 'GET' } })
  })

  it('serializes JSON with the expected content type', async () => {
    fetchMock.mockResolvedValue(response('{}'))
    await searchHttpRequest({ ...requestOptions, method: 'POST', body: { query: { match_all: {} } } })
    expect(fetchMock).toHaveBeenCalledWith(requestOptions.url, expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      body: '{"query":{"match_all":{}}}'
    }))
  })

  it('preserves an explicit Content-Type header for native engine bodies', async () => {
    fetchMock.mockResolvedValue(response('ok'))
    await expect(searchHttpRequest({
      ...requestOptions, method: 'POST', rawBody: 'q=*:*',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, responseType: 'text'
    })).resolves.toBe('ok')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Accept: 'application/json, text/plain', 'content-type': 'application/x-www-form-urlencoded'
    })
  })

  it('rejects mutually exclusive raw and JSON bodies before making a request', async () => {
    await expect(searchHttpRequest({ ...requestOptions, body: {}, rawBody: '{}' })).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels an unused response body for no-content operations', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    fetchMock.mockResolvedValue(response('', { body: { cancel } as unknown as ReadableStream<Uint8Array> }))

    await expect(searchHttpRequest({ ...requestOptions, responseType: 'none' })).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
