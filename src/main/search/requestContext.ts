import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  connectionId?: string
  resourceName?: string
  requestSeq?: number
  signal?: AbortSignal
  requestId?: string
  jobId?: string
}

const requestContexts = new AsyncLocalStorage<RequestContext>()

/** Each asynchronous request chain inherits its own cancellation signal. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContexts.run(context, fn)
}

export function getCurrentRequestSignal(): AbortSignal | undefined {
  return requestContexts.getStore()?.signal
}
