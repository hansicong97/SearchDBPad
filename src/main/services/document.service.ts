/**
 * Document search / CRUD business logic.
 *
 * V0.3.0: routed through the adapter. IPC input / output shapes
 *  (`DocumentSearchRequest`, `DocumentSearchResult`, etc.) are
 *  unchanged so the renderer's search panel + document editor +
 *  delete dialog keep working without modification.
 *
 *  Note: `deleteDocument` no longer needs the 404 → `not_found`
 *  special case in the service — the adapter already converts that
 *  into a soft success. Real failures reach the catch and are
 *  formatted by `describeWriteError`.
 */

import { resolveAdapterByConnectionId } from './searchEngine.service'
import { SearchEngineError } from '../search/errors'
import type {
  ApiResponse,
  DocumentDeleteRequest,
  DocumentDeleteResult,
  DocumentSearchRequest,
  DocumentSearchResult,
  DocumentWriteRequest,
  DocumentWriteResult
} from '../../shared/ipc'
import type {
  DocumentCreateInput,
  DocumentDeleteInput,
  DocumentSearchInput,
  DocumentUpdateInput
} from '../search/adapter.types'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function describeIndexError(err: unknown, index: string): string {
  if (err instanceof SearchEngineError) {
    if (err.status === 404) return `索引 "${index}" 不存在`
    if (err.status === 400) return `DSL 无效或索引名非法: ${index}`
  }
  return errMsg(err)
}

function describeWriteError(
  err: unknown,
  index: string,
  id: string | null
): string {
  if (err instanceof SearchEngineError) {
    if (err.status === 404) {
      return id
        ? `索引 "${index}" 不存在，无法对 _id="${id}" 进行操作`
        : `索引 "${index}" 不存在`
    }
    if (err.status === 400) {
      const reason =
        err.details &&
        typeof err.details === 'object' &&
        'error' in err.details
          ? (err.details as { error?: { type?: string } }).error?.type
          : undefined
      return `${reason ?? '请求格式错误'}（${index}${id ? `/${id}` : ''}）`
    }
    if (err.status === 409) {
      return `版本冲突：${index}/${id ?? ''}`
    }
  }
  return errMsg(err)
}

export async function searchDocuments(
  req: DocumentSearchRequest
): Promise<ApiResponse<DocumentSearchResult>> {
  const { connectionId, index, query } = req
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const input: DocumentSearchInput = { index, query }
    const data = await adapter.searchDocuments(connection, input)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeIndexError(err, index) }
    }
  }
}

export async function createDocument(
  req: DocumentWriteRequest
): Promise<ApiResponse<DocumentWriteResult>> {
  const { connectionId, index, id, source } = req
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const input: DocumentCreateInput = { index, id, source }
    const data = await adapter.createDocument(connection, input)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeWriteError(err, index, id ?? null) }
    }
  }
}

export async function updateDocument(
  req: DocumentWriteRequest
): Promise<ApiResponse<DocumentWriteResult>> {
  const { connectionId, index, id, source } = req
  if (!id || id.trim() === '') {
    return { success: false, error: { message: '更新文档需要提供 _id' } }
  }
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const input: DocumentUpdateInput = { index, id, source }
    const data = await adapter.updateDocument(connection, input)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: { message: describeWriteError(err, index, id) }
    }
  }
}

export async function deleteDocument(
  req: DocumentDeleteRequest
): Promise<ApiResponse<DocumentDeleteResult>> {
  const { connectionId, index, id } = req
  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const input: DocumentDeleteInput = { index, id }
    const data = await adapter.deleteDocument(connection, input)
    return { success: true, data }
  } catch (err) {
    // The adapter maps ES 404 to a soft `not_found` success, so any
    // throw reaching this catch is a genuine failure.
    return {
      success: false,
      error: { message: describeWriteError(err, index, id) }
    }
  }
}