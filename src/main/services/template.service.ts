/**
 * Index template business logic (V0.3.4 A-5).
 *
 * Thin pass-through to the adapter. Errors propagate verbatim so the
 * renderer can show the ES server message (e.g. "index_patterns must
 * not be empty").
 */

import { resolveAdapterByConnectionId } from './searchEngine.service'
import type {
  ApiResponse,
  IndexTemplateCreateRequest,
  IndexTemplateDeleteRequest,
  IndexTemplateGetRequest,
  IndexTemplateGetResult,
  IndexTemplateListResult,
  IndexTemplateModifyResult
} from '../../shared/ipc'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function listIndexTemplates(
  connectionId: string
): Promise<ApiResponse<IndexTemplateListResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      connectionId
    )
    const data = await adapter.listIndexTemplates(connection)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: { message: errMsg(err) } }
  }
}

export async function getIndexTemplate(
  req: IndexTemplateGetRequest
): Promise<ApiResponse<IndexTemplateGetResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.getIndexTemplate(connection, req.name)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: { message: errMsg(err) } }
  }
}

export async function createIndexTemplate(
  req: IndexTemplateCreateRequest
): Promise<ApiResponse<IndexTemplateModifyResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.createIndexTemplate(
      connection,
      req.name,
      req.template,
      req.legacy
    )
    return { success: true, data }
  } catch (err) {
    return { success: false, error: { message: errMsg(err) } }
  }
}

export async function deleteIndexTemplate(
  req: IndexTemplateDeleteRequest
): Promise<ApiResponse<IndexTemplateModifyResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await adapter.deleteIndexTemplate(
      connection,
      req.name,
      req.legacy
    )
    return { success: true, data }
  } catch (err) {
    return { success: false, error: { message: errMsg(err) } }
  }
}
