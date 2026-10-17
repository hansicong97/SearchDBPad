/** REST task operations shared by Elasticsearch and OpenSearch adapters. */
import { elasticsearchRequest } from './client'
import { SearchEngineError } from '../../search/errors'
import { detect } from './detector'
import { getCachedServerInfo, setCachedServerInfo } from '../../search/serverVersionCache'
import type { SearchConnection } from '../../../shared/searchEngine'
import type { EngineTaskRequest, EngineTaskResult } from '../../../shared/ipc'

type TaskInput = Omit<EngineTaskRequest, 'connectionId'> & {signal?: AbortSignal}
type ObjectValue = Record<string, unknown>

function isObject(value: unknown): value is ObjectValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalid(connection: SearchConnection, message: string): never {
  throw new SearchEngineError({engineType: connection.engineType, code: 'parse_error', message})
}

/** One concrete resource per destructive request; callers must select it. */
function resource(connection: SearchConnection, name: unknown): string {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || name === '_all'
    || /[\s\/\\,*?#:<>|]/.test(name)) {
    invalid(connection, '任务必须指定一个有效资源，不支持通配符或多个资源。')
  }
  return name
}

function taskReference(connection: SearchConnection, taskId: string): string {
  if (!/^[A-Za-z0-9_.-]+:\d+$/.test(taskId)) invalid(connection, '任务 ID 格式无效。')
  return encodeURIComponent(taskId)
}

function validateKeys(connection: SearchConnection, body: ObjectValue, allowed: string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) invalid(connection, '任务包含不支持的请求字段。')
}

function mutationBody(connection: SearchConnection, input: TaskInput): {path: string; body: ObjectValue} {
  const name = resource(connection, input.resourceName)
  if (!isObject(input.body)) invalid(connection, '任务请求体必须是 JSON 对象。')
  if (input.operation === 'reindex') {
    validateKeys(connection, input.body, ['source', 'dest', 'script', 'conflicts', 'max_docs'])
    if (!isObject(input.body.source) || !isObject(input.body.dest)) invalid(connection, 'Reindex 必须提供 source 和 dest 对象。')
    const source = input.body.source
    const dest = input.body.dest
    if (source.remote !== undefined) invalid(connection, '当前 Reindex 仅支持当前连接内的资源。')
    validateKeys(connection, source, ['index', 'query', '_source', 'size', 'slice'])
    validateKeys(connection, dest, ['index', 'op_type', 'version_type', 'pipeline', 'routing'])
    if (source.index !== undefined && source.index !== name) invalid(connection, 'Reindex source.index 必须与当前资源一致。')
    const target = resource(connection, dest.index)
    if (target === name) invalid(connection, 'Reindex 的源和目标资源不能相同。')
    if (source.query !== undefined && !isObject(source.query)) invalid(connection, 'Reindex source.query 必须是 JSON 对象。')
    validateOptions(connection, input.body)
    return {path: '/_reindex', body: {...input.body, source: {...source, index: name}, dest: {...dest, index: target}}}
  }
  if (input.operation !== 'updateByQuery' && input.operation !== 'deleteByQuery') invalid(connection, '不支持的任务操作。')
  validateKeys(connection, input.body, input.operation === 'updateByQuery' ? ['query', 'script', 'max_docs'] : ['query', 'max_docs'])
  if (!isObject(input.body.query)) invalid(connection, '批量修改或删除必须显式提供 query 对象。')
  validateOptions(connection, input.body)
  return {path: `/${encodeURIComponent(name)}/${input.operation === 'updateByQuery' ? '_update_by_query' : '_delete_by_query'}`, body: {...input.body}}
}

function validateOptions(connection: SearchConnection, body: ObjectValue): void {
  if (body.script !== undefined && (!isObject(body.script) || (typeof body.script.source !== 'string' && typeof body.script.id !== 'string'))) {
    invalid(connection, 'script 必须包含 source 或已存储脚本 id。')
  }
  if (body.max_docs !== undefined && (typeof body.max_docs !== 'number' || !Number.isSafeInteger(body.max_docs) || body.max_docs < 1)) {
    invalid(connection, 'max_docs 必须是正整数。')
  }
  if (body.conflicts !== undefined && body.conflicts !== 'abort' && body.conflicts !== 'proceed') invalid(connection, 'conflicts 仅支持 abort 或 proceed。')
}

export async function executeTask(connection: SearchConnection, input: TaskInput): Promise<EngineTaskResult> {
  const request = mutationBody(connection, input)
  const query: Record<string, string | number | boolean> = {wait_for_completion: false, refresh: false}
  // ES 6 calls the total document limit `size`; newer ES/OpenSearch use
  // max_docs. Keep this compatibility decision inside the REST adapter.
  if (request.body.max_docs !== undefined) {
    const info = getCachedServerInfo(connection.id) ?? await detect(connection)
    setCachedServerInfo(connection.id, info)
    const limit = request.body.max_docs as number
    delete request.body.max_docs
    if (input.operation === 'reindex') request.body[info.engineType === 'elasticsearch' && info.major === 6 ? 'size' : 'max_docs'] = limit
    else query[info.engineType === 'elasticsearch' && info.major === 6 ? 'size' : 'max_docs'] = limit
  }
  const result = await elasticsearchRequest<{task?: string}>(connection, {
    method: 'POST', ...request, query, signal: input.signal
  })
  if (typeof result?.task !== 'string' || !/^[A-Za-z0-9_.-]+:\d+$/.test(result.task)) {
    throw new SearchEngineError({engineType: connection.engineType, code: 'parse_error', message: '服务器未返回有效的异步任务 ID。'})
  }
  return {connectionId: connection.id, taskId: result.task, completed: false}
}

/** Task payloads can include scripts/headers. Expose only safe counters. */
function safeCounters(value: unknown): ObjectValue | undefined {
  if (!isObject(value)) return undefined
  const result: ObjectValue = {}
  for (const key of ['total', 'updated', 'created', 'deleted', 'batches', 'version_conflicts', 'noops', 'throttled_millis', 'requests_per_second']) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) result[key] = value[key]
  }
  if (typeof value.timed_out === 'boolean') result.timed_out = value.timed_out
  if (Array.isArray(value.failures)) result.failureCount = value.failures.length
  return result
}

export async function getTask(connection: SearchConnection, taskId: string): Promise<EngineTaskResult> {
  const result = await elasticsearchRequest<{completed?: boolean; task?: {cancelled?: boolean; status?: unknown}; response?: unknown; error?: unknown}>(connection, {
    method: 'GET', path: '/_tasks/' + taskReference(connection, taskId)
  })
  if (!result || typeof result.completed !== 'boolean') throw new SearchEngineError({engineType: connection.engineType, code: 'parse_error', message: '服务器任务状态响应格式无效。'})
  const response = safeCounters(result.completed ? result.response : result.task?.status)
  return {connectionId: connection.id, taskId, completed: result.completed, cancelled: result.task?.cancelled, response,
    error: result.error || (typeof response?.failureCount === 'number' && response.failureCount > 0) ? '服务器任务执行失败或部分失败，请检查查询、资源权限及服务器日志。' : undefined}
}

export async function cancelTask(connection: SearchConnection, taskId: string): Promise<EngineTaskResult> {
  const result = await elasticsearchRequest<{nodes?: Record<string, {tasks?: Record<string, {cancelled?: boolean}>}>}>(connection, {
    method: 'POST', path: '/_tasks/' + taskReference(connection, taskId) + '/_cancel'
  })
  const task = Object.values(result?.nodes ?? {}).map(node => node.tasks?.[taskId]).find(Boolean)
  // Cancellation is cooperative on the server. It is not completion.
  return {connectionId: connection.id, taskId, completed: false, cancelled: task?.cancelled === true}
}
