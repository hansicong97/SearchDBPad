import type { ApiResponse, ResourceRequest, SearchQueryRequest, SearchResourceListResult, SearchEngineCapabilitiesResult, EngineTaskRequest, EngineTaskRef, EngineTaskResult } from '../../shared/ipc'
import type { SearchQueryResult, SearchSchemaResult } from '../../shared/searchEngine'
import { resolveAdapterByConnectionId } from './searchEngine.service'
import { requireOperation } from '../search/adapter.types'
import { toPublicSearchError } from '../search/errors'
import { getCurrentRequestSignal } from '../search/requestContext'
import { setCachedServerInfo } from '../search/serverVersionCache'
import { assertObject, assertNonEmptyString, assertResourceName, assertRequestSeq } from './requestValidation'

export function safeFailure(error: unknown, operation: string): ApiResponse<never> {
  return { success: false, error: toPublicSearchError(error, operation) }
}

export function validateResource(request: ResourceRequest): void {
  assertObject(request)
  assertNonEmptyString(request.connectionId)
  assertResourceName(request.resourceName)
  assertRequestSeq(request.requestSeq)
}

export async function getCapabilities(connectionId: string): Promise<ApiResponse<SearchEngineCapabilitiesResult>> {
  try {
    assertNonEmptyString(connectionId)
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    // Successful identity detection is required before exposing write actions.
    const info = await adapter.detect(connection)
    setCachedServerInfo(connectionId, info)
    return { success: true, data: { connectionId, engineType: connection.engineType, capabilities: await adapter.getCapabilities(connection) } }
  } catch (error) { return safeFailure(error, 'capabilities') }
}

export async function listResources(connectionId: string): Promise<ApiResponse<SearchResourceListResult>> {
  try {
    assertNonEmptyString(connectionId)
    const { connection, adapter } = await resolveAdapterByConnectionId(connectionId)
    const resources = await requireOperation(adapter, 'listResources')(connection)
    return { success: true, data: { connectionId, resources, resourceCount: resources.length } }
  } catch (error) { return safeFailure(error, 'resources.list') }
}

export async function getResourceSchema(request: ResourceRequest): Promise<ApiResponse<SearchSchemaResult>> {
  try {
    validateResource(request)
    const { connection, adapter } = await resolveAdapterByConnectionId(request.connectionId)
    return { success: true, data: await requireOperation(adapter, 'getSchema')(connection, request.resourceName) }
  } catch (error) { return safeFailure(error, 'resources.schema') }
}

export async function queryResource(request: SearchQueryRequest): Promise<ApiResponse<SearchQueryResult>> {
  try {
    validateResource(request)
    assertObject(request.query)
    if (request.queryLanguage !== 'solr' && request.queryLanguage !== 'elasticsearch-dsl') throw new TypeError('Invalid query language')
    const { connection, adapter } = await resolveAdapterByConnectionId(request.connectionId)
    if (!adapter.manifest.queryLanguages.includes(request.queryLanguage)) throw new TypeError('Invalid query language')
    return {
      success: true,
      data: await requireOperation(adapter, 'queryDocuments')(connection, {
        ...request,
        signal: getCurrentRequestSignal()
      })
    }
  } catch (error) { return safeFailure(error, 'resources.query') }
}

export async function executeTask(request: EngineTaskRequest): Promise<ApiResponse<EngineTaskResult>> {
  try {
    validateResource(request)
    if (!['reindex', 'updateByQuery', 'deleteByQuery'].includes(request.operation)) throw new TypeError('Invalid task operation')
    assertObject(request.body)
    const { connection, adapter } = await resolveAdapterByConnectionId(request.connectionId)
    return { success: true, data: await requireOperation(adapter, 'executeTask')(connection, request) }
  } catch (error) { return safeFailure(error, 'tasks.execute') }
}

export async function inspectTask(request: EngineTaskRef, cancel = false): Promise<ApiResponse<EngineTaskResult>> {
  try {
    assertObject(request)
    assertNonEmptyString(request.connectionId)
    assertNonEmptyString(request.taskId)
    const { connection, adapter } = await resolveAdapterByConnectionId(request.connectionId)
    const data = cancel ? await requireOperation(adapter, 'cancelTask')(connection, request.taskId) : await requireOperation(adapter, 'getTask')(connection, request.taskId)
    return { success: true, data }
  } catch (error) { return safeFailure(error, cancel ? 'tasks.cancel' : 'tasks.status') }
}
