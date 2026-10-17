import { runWithRequestContext } from './requestContext'
import type { RequestCancelRequest } from '../../shared/ipc'

const requests = new Map<string, AbortController>()
function key(sender: number, request: RequestCancelRequest): string {
  return JSON.stringify([sender, request.connectionId, request.resourceName ?? '', request.requestSeq])
}
function validate(request: RequestCancelRequest): void {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
    typeof request.connectionId !== 'string' || !request.connectionId.trim() ||
    (request.resourceName !== undefined && (typeof request.resourceName !== 'string' || !request.resourceName.trim())) ||
    !Number.isSafeInteger(request.requestSeq) || request.requestSeq < 0) throw new TypeError('Invalid request context')
}
export async function runRequest<T>(sender: number, request: RequestCancelRequest, operation: () => Promise<T>): Promise<T> {
  validate(request)
  const id = key(sender, request)
  requests.get(id)?.abort()
  const controller = new AbortController()
  requests.set(id, controller)
  try { return await runWithRequestContext({ ...request, signal: controller.signal }, operation) }
  finally { if (requests.get(id) === controller) requests.delete(id) }
}
export function cancelRequest(sender: number, request: RequestCancelRequest): boolean {
  validate(request)
  const controller = requests.get(key(sender, request))
  controller?.abort()
  return !!controller
}
export function cancelSenderRequests(sender: number): void {
  for (const [id, controller] of requests) {
    if ((JSON.parse(id) as unknown[])[0] === sender) { controller.abort(); requests.delete(id) }
  }
}
