import { requireOperation } from '../search/adapter.types'
/**
 * Document search / CRUD business logic.
 *
 * Routes query and write operations through optional adapter capabilities.
 * The shared document contract carries engine-neutral fields and optional
 * commit policy; adapters own engine-specific request and response shapes.
 * Public errors are mapped centrally and never expose transport details.
 */

import { resolveAdapterByConnectionId } from './searchEngine.service'
import { SearchEngineError, toPublicSearchError } from '../search/errors'
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
import type { SearchQueryInput } from '../../shared/searchEngine'
import { assertObject, assertNonEmptyString, assertResourceName, assertCommitPolicy } from './requestValidation'

function validateDocumentRequest(req: unknown): void {
  assertObject(req)
  assertNonEmptyString(req.connectionId)
  assertResourceName(req.index)
  assertCommitPolicy(req.commitPolicy)
  if (req.id !== undefined) assertNonEmptyString(req.id)
}

function describeIndexError(err: unknown, operation: string) {
  const safe = toPublicSearchError(err, operation)
  if (safe.code === 'resource_not_found') safe.message = '请求的索引或资源不存在，请刷新后重试'
  else if (safe.code === 'invalid_request' || safe.code === 'parse_error') {
    safe.message = '查询请求无效或索引名非法，请检查输入'
  }
  return safe
}

function describeWriteError(
  err: unknown,
  operation: string
): ReturnType<typeof toPublicSearchError> {
  const safe = toPublicSearchError(err, operation)
  if (safe.code === 'resource_not_found') {
    safe.message = '请求的索引或文档不存在，请刷新后重试'
  } else if (safe.code === 'conflict') {
    safe.message = '文档版本冲突，请刷新后重试'
  } else if (safe.code === 'invalid_request' || safe.code === 'parse_error') {
    safe.message = '文档请求格式无效，请检查输入'
  }
  return safe
}

export async function searchDocuments(
  req: DocumentSearchRequest
): Promise<ApiResponse<DocumentSearchResult>> {
  try {
    validateDocumentRequest(req)
    assertObject(req.query)
    const { connectionId, index, query } = req
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    // The generic query contract is the primary path for multi-engine
    // connections. Keep the legacy ES operation as a fallback for adapters
    // that have not migrated yet.
    if (typeof adapter.queryDocuments === 'function') {
      const queryLanguage = req.queryLanguage ?? (
        connection.engineType === 'solr' ? 'solr' : 'elasticsearch-dsl'
      )
      if (!adapter.manifest.queryLanguages.includes(queryLanguage)) {
        throw new SearchEngineError({
          engineType: connection.engineType,
          code: 'unsupported_capability',
          message: `当前引擎不支持查询语言 ${queryLanguage}`
        })
      }
      const input: SearchQueryInput = {
        resourceName: index,
        queryLanguage,
        query
      }
      const result = await requireOperation(adapter, 'queryDocuments')(connection, input)
      const data: DocumentSearchResult = {
        connectionId: result.connectionId,
        index: result.resourceName,
        took: result.took,
        total: result.total,
        totalRelation: result.totalRelation,
        hits: result.hits,
        raw: result.raw
      }
      return { success: true, data }
    }
    const input: DocumentSearchInput = { index, query }
    const data = await requireOperation(adapter, 'searchDocuments')(connection, input)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: describeIndexError(err, 'document:search')
    }
  }
}

export async function createDocument(
  req: DocumentWriteRequest
): Promise<ApiResponse<DocumentWriteResult>> {
  try {
    validateDocumentRequest(req)
    assertObject(req.source)
    const { connectionId, index, id, source, commitPolicy } = req
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const input: DocumentCreateInput = { index, id, source, commitPolicy }
    const data = await requireOperation(adapter, 'createDocument')(connection, input)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: describeWriteError(err, 'document:create')
    }
  }
}

export async function updateDocument(
  req: DocumentWriteRequest
): Promise<ApiResponse<DocumentWriteResult>> {
  try {
    validateDocumentRequest(req)
    assertNonEmptyString(req.id)
    assertObject(req.source)
    const { connectionId, index, id, source, commitPolicy } = req
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const input: DocumentUpdateInput = { index, id, source, commitPolicy }
    const data = await requireOperation(adapter, 'updateDocument')(connection, input)
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: describeWriteError(err, 'document:update')
    }
  }
}

export async function deleteDocument(
  req: DocumentDeleteRequest
): Promise<ApiResponse<DocumentDeleteResult>> {
  try {
    validateDocumentRequest(req)
    assertNonEmptyString(req.id)
    const { connectionId, index, id, commitPolicy } = req
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const input: DocumentDeleteInput = { index, id, commitPolicy }
    const data = await requireOperation(adapter, 'deleteDocument')(connection, input)
    return { success: true, data }
  } catch (err) {
    // The adapter maps ES 404 to a soft `not_found` success, so any
    // throw reaching this catch is a genuine failure.
    return {
      success: false,
      error: describeWriteError(err, 'document:delete')
    }
  }
}
