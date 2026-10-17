import type { ApiResponse, RequestCancelRequest, SearchQueryRequest } from '../../shared/ipc'
import type { SearchQueryResult } from '../../shared/searchEngine'
import { cancelRequest, runRequest } from '../search/requestRegistry'
import { queryResource, safeFailure } from './resource.service'

/** Keep request registration inside the same safe boundary as the query itself. */
export async function handleResourceQuery(
  senderId: number,
  request: SearchQueryRequest
): Promise<ApiResponse<SearchQueryResult>> {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new TypeError('Invalid query request')
    }
    return await runRequest(senderId, {
      connectionId: request.connectionId,
      resourceName: request.resourceName,
      requestSeq: request.requestSeq === undefined ? 0 : request.requestSeq
    }, () => queryResource(request))
  } catch (error) {
    return safeFailure(error, 'resources.query')
  }
}

/** IPC callers always receive a serializable response, including invalid contexts. */
export function handleRequestCancel(
  senderId: number,
  request: RequestCancelRequest
): ApiResponse<{ cancelled: boolean }> {
  try {
    return { success: true, data: { cancelled: cancelRequest(senderId, request) } }
  } catch (error) {
    return safeFailure(error, 'requests.cancel')
  }
}
