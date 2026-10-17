import { requireOperation } from '../search/adapter.types'
/**
 * Index template business logic (V0.3.4 A-5).
 *
 * Thin pass-through to the adapter. Errors are mapped to the safe public
 * envelope so server responses and connection details never cross IPC.
 */

import { resolveAdapterByConnectionId } from './searchEngine.service'
import { toPublicSearchError } from '../search/errors'
import type {
  ApiResponse,
  IndexTemplateCreateRequest,
  IndexTemplateDeleteRequest,
  IndexTemplateGetRequest,
  IndexTemplateGetResult,
  IndexTemplateListResult,
  IndexTemplateModifyResult
} from '../../shared/ipc'

export async function listIndexTemplates(
  connectionId: string
): Promise<ApiResponse<IndexTemplateListResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      connectionId
    )
    const data = await requireOperation(adapter, 'listIndexTemplates')(connection)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toPublicSearchError(err, 'template:list') }
  }
}

export async function getIndexTemplate(
  req: IndexTemplateGetRequest
): Promise<ApiResponse<IndexTemplateGetResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await requireOperation(adapter, 'getIndexTemplate')(connection, req.name)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toPublicSearchError(err, 'template:get') }
  }
}

export async function createIndexTemplate(
  req: IndexTemplateCreateRequest
): Promise<ApiResponse<IndexTemplateModifyResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await requireOperation(adapter, 'createIndexTemplate')(
      connection,
      req.name,
      req.template,
      req.legacy
    )
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toPublicSearchError(err, 'template:create') }
  }
}

export async function deleteIndexTemplate(
  req: IndexTemplateDeleteRequest
): Promise<ApiResponse<IndexTemplateModifyResult>> {
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      req.connectionId
    )
    const data = await requireOperation(adapter, 'deleteIndexTemplate')(
      connection,
      req.name,
      req.legacy
    )
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toPublicSearchError(err, 'template:delete') }
  }
}
