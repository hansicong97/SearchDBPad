/** Solr 8/9 adapter. Collection/core/schema/query semantics stay local. */
import { solrRequest } from './client'
import { SearchEngineError } from '../../search/errors'
import type { SearchEngineAdapter, DocumentCreateInput, DocumentUpdateInput, DocumentDeleteInput, ImportInput, ImportResult, ExportInput, ExportResult } from '../../search/adapter.types'
import { emptySearchEngineCapabilities } from '../../../shared/searchEngine'
import type { SearchConnection, SearchEngineManifest, SearchEngineServerInfo, SearchResourceInfo, SearchSchemaResult, SearchQueryResult, SearchQueryInput, CommitPolicy } from '../../../shared/searchEngine'
import type { ConnectionTestResult, DocumentHit, DocumentWriteResult, DocumentDeleteResult } from '../../../shared/ipc'

export const solrManifest: SearchEngineManifest = {
  manifestVersion: 1, adapterVersion: '1.0.0', type: 'solr', displayName: 'Apache Solr', protocolFamily: 'solr-rest',
  supportedVersions: ['8.x', '9.x'], authSchemes: ['none', 'basic'], resourceModel: 'mixed',
  queryLanguages: ['solr'], transferFormats: ['json', 'csv'],
  capabilities: {...emptySearchEngineCapabilities(), resourceCatalog: true, documentQuery: true,
    documentWrite: true, schema: true, bulkTransfer: true, importExport: true}
}

interface SolrSystemInfo { lucene?: Record<string, unknown>; mode?: string }
interface SolrSchemaResponse { schema?: { uniqueKey?: string; fields?: Array<Record<string, unknown>> } }
interface SolrSelectResponse {
  responseHeader?: { QTime?: number; partialResults?: boolean }
  response?: { numFound?: number; docs?: Array<Record<string, unknown>> }
  nextCursorMark?: string
}
interface SolrWriteOptions { signal?: AbortSignal; commitPolicy?: CommitPolicy }
const uniqueKeyCache = new Map<string, string | undefined>()
const resourcePath = (resourceName: string): string => {
  if (!/^[A-Za-z0-9_.-]+$/.test(resourceName) || resourceName === '.' || resourceName === '..') {
    throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: 'Solr 资源名称无效。'})
  }
  return '/' + encodeURIComponent(resourceName)
}
const schemaCacheKey = (connection: SearchConnection, name: string) => JSON.stringify([connection.id, connection.url, name])

export function parseSolrInfo(response: SolrSystemInfo): SearchEngineServerInfo {
  const version = String(response.lucene?.['solr-spec-version'] ?? '')
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/.exec(version)
  if (!match || ![8, 9].includes(Number(match[1]))) {
    throw new SearchEngineError({engineType: 'solr', code: 'unsupported_capability', message: '当前 Solr adapter 支持 Solr 8.x 和 9.x。'})
  }
  return {engineType: 'solr', engineName: 'Apache Solr', version, major: Number(match[1]),
    minor: Number(match[2]), patch: Number(match[3] ?? 0), distribution: response.mode, compatibleRange: '8.x-9.x'}
}

export async function detect(connection: SearchConnection): Promise<SearchEngineServerInfo> {
  return parseSolrInfo(await solrRequest<SolrSystemInfo>(connection, {method: 'GET', path: '/admin/info/system'}))
}

export async function testConnection(connection: SearchConnection): Promise<ConnectionTestResult> {
  try {
    const info = await detect(connection)
    return {reachable: true, version: info.version, clusterName: info.distribution ?? 'Apache Solr', health: 'unknown'}
  } catch {
    return {reachable: false, message: '无法连接受支持的 Solr 8/9 服务器，请检查地址（通常以 /solr 结尾）、认证和版本。'}
  }
}

export async function listResources(connection: SearchConnection): Promise<SearchResourceInfo[]> {
  try {
    const result = await solrRequest<{collections?: string[]}>(connection, {method: 'GET', path: '/admin/collections', query: {action: 'LIST'}})
    if (!Array.isArray(result.collections)) throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: 'Solr Collection 列表响应格式无效。'})
    return result.collections.filter((name): name is string => typeof name === 'string').sort().map(name => ({name, kind: 'collection'}))
  } catch (error) {
    // Standalone Solr returns 400 for Collections API. Never turn auth/network
    // failures into a misleading empty core list.
    if (!(error instanceof SearchEngineError) || ![400, 404].includes(error.status ?? 0)) throw error
    const result = await solrRequest<{status?: Record<string, {name?: string; index?: {numDocs?: number}}> }>(connection, {method: 'GET', path: '/admin/cores', query: {action: 'STATUS', indexInfo: true}})
    if (!result.status || typeof result.status !== 'object') throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: 'Solr Core 列表响应格式无效。'})
    return Object.entries(result.status).map(([key, core]) => ({name: core.name ?? key, kind: 'core' as const, documentCount: core.index?.numDocs})).sort((a, b) => a.name.localeCompare(b.name))
  }
}

export async function getSchema(connection: SearchConnection, resourceName: string, signal?: AbortSignal): Promise<SearchSchemaResult> {
  ensureNotCancelled({signal})
  const raw = await solrRequest<SolrSchemaResponse>(connection, {method: 'GET', path: resourcePath(resourceName) + '/schema', signal})
  if (!raw.schema || !Array.isArray(raw.schema.fields)) throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: 'Solr Schema 响应格式无效。'})
  const uniqueKey = typeof raw.schema.uniqueKey === 'string' ? raw.schema.uniqueKey : undefined
  if (uniqueKeyCache.size >= 256) uniqueKeyCache.delete(uniqueKeyCache.keys().next().value!)
  uniqueKeyCache.set(schemaCacheKey(connection, resourceName), uniqueKey)
  return {connectionId: connection.id, resourceName, uniqueKey, raw, fields: raw.schema.fields.map(field => ({
    name: String(field.name ?? ''), type: typeof field.type === 'string' ? field.type : undefined,
    multiValued: typeof field.multiValued === 'boolean' ? field.multiValued : undefined,
    required: typeof field.required === 'boolean' ? field.required : undefined,
    stored: typeof field.stored === 'boolean' ? field.stored : undefined
  })).filter(field => field.name.length > 0)}
}

async function getUniqueKey(connection: SearchConnection, name: string, signal?: AbortSignal): Promise<string | undefined> {
  ensureNotCancelled({signal})
  const key = schemaCacheKey(connection, name)
  if (!uniqueKeyCache.has(key)) await getSchema(connection, name, signal)
  return uniqueKeyCache.get(key)
}

export function buildSolrQuery(query: Record<string, unknown>): Record<string, string | number | string[]> {
  const allowed = new Set(['q', 'fq', 'sort', 'start', 'rows', 'fl', 'df'])
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) throw new SearchEngineError({engineType: 'solr', code: 'unsupported_capability', message: `不支持的 Solr 查询参数: ${key}`})
  }
  const result: Record<string, string | number | string[]> = {q: '*:*', start: 0, rows: 20}
  for (const [key, value] of Object.entries(query)) {
    if (key === 'start' || key === 'rows') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || (key === 'rows' && value > 10000)) throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: 'Solr start/rows 必须是非负整数，rows 不可超过 10000。'})
      result[key] = value
    } else if (key === 'fq' && Array.isArray(value) && value.every(v => typeof v === 'string')) {
      result[key] = value as string[]
    } else if (typeof value === 'string') {
      result[key] = value
    } else throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: `Solr 查询参数 ${key} 格式无效。`})
  }
  return result
}

function mapHit(fields: Record<string, unknown>, uniqueKey?: string): DocumentHit {
  const id = uniqueKey ? fields[uniqueKey] : undefined
  return {id: typeof id === 'string' || typeof id === 'number' ? String(id) : undefined, fields, raw: fields}
}

export async function queryDocuments(connection: SearchConnection, input: SearchQueryInput): Promise<SearchQueryResult> {
  if (input.queryLanguage !== 'solr') throw new SearchEngineError({engineType: 'solr', code: 'unsupported_capability', message: 'Solr 只接受原生 q/fq/sort/start/rows 参数。'})
  const query = buildSolrQuery(input.query)
  const uniqueKey = await getUniqueKey(connection, input.resourceName, input.signal)
  const raw = await solrRequest<SolrSelectResponse>(connection, {method: 'GET', path: resourcePath(input.resourceName) + '/select', query, signal: input.signal})
  if (!raw.response || !Array.isArray(raw.response.docs)) throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: 'Solr 查询响应格式无效。'})
  return {connectionId: connection.id, resourceName: input.resourceName, requestSeq: input.requestSeq,
    took: raw.responseHeader?.QTime ?? 0, total: raw.response.numFound ?? 0,
    totalRelation: raw.responseHeader?.partialResults ? 'gte' : 'eq',
    hits: raw.response.docs.map(doc => mapHit(doc, uniqueKey)), raw}
}

function commitQuery(policy?: CommitPolicy): Record<string, boolean> {
  return policy === 'commit' ? {commit: true} : policy === 'softCommit' ? {softCommit: true} : {}
}

function ensureNotCancelled(input: {signal?: AbortSignal; isCancelled?: () => boolean}): void {
  if (input.signal?.aborted || input.isCancelled?.()) {
    const error = new Error('用户已停止操作。')
    error.name = 'AbortError'
    throw error
  }
}

function prepareDocument(uniqueKey: string, source: Record<string, unknown>, id?: string): {document: Record<string, unknown>; id: string} {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: '文档必须是 JSON 对象。'})
  const document = {...source}
  delete document._version_
  if (id !== undefined) {
    if (document[uniqueKey] !== undefined && String(document[uniqueKey]) !== id) throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: '文档 ID 与 Schema uniqueKey 字段不一致。'})
    if (document[uniqueKey] === undefined) document[uniqueKey] = id
  }
  const value = document[uniqueKey]
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value)) || String(value).length === 0) throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: `文档必须包含有效的 uniqueKey 字段 ${uniqueKey}。`})
  return {document, id: String(value)}
}

async function writeDocument(connection: SearchConnection, input: DocumentCreateInput & SolrWriteOptions, result: 'created' | 'updated'): Promise<DocumentWriteResult> {
  const uniqueKey = await getUniqueKey(connection, input.index, input.signal)
  if (!uniqueKey) throw new SearchEngineError({engineType: 'solr', code: 'unsupported_capability', message: '该 Solr Schema 未定义 uniqueKey，无法安全写入或编辑文档。'})
  const prepared = prepareDocument(uniqueKey, input.source, input.id)
  await solrRequest(connection, {method: 'POST', path: resourcePath(input.index) + '/update', body: {add: {doc: prepared.document, overwrite: true}}, query: commitQuery(input.commitPolicy), signal: input.signal})
  return {connectionId: connection.id, index: input.index, id: prepared.id, result, version: 0}
}
export const createDocument = (connection: SearchConnection, input: DocumentCreateInput & SolrWriteOptions) => writeDocument(connection, input, 'created')
export const updateDocument = (connection: SearchConnection, input: DocumentUpdateInput & SolrWriteOptions) => writeDocument(connection, input, 'updated')

export async function deleteDocument(connection: SearchConnection, input: DocumentDeleteInput & SolrWriteOptions): Promise<DocumentDeleteResult> {
  if (!await getUniqueKey(connection, input.index, input.signal)) throw new SearchEngineError({engineType: 'solr', code: 'unsupported_capability', message: '该 Solr Schema 未定义 uniqueKey，无法按 ID 删除。'})
  await solrRequest(connection, {method: 'POST', path: resourcePath(input.index) + '/update', body: {delete: {id: input.id}}, query: commitQuery(input.commitPolicy), signal: input.signal})
  return {connectionId: connection.id, index: input.index, id: input.id, result: 'deleted', version: 0}
}

export async function importDocuments(connection: SearchConnection, input: ImportInput & SolrWriteOptions): Promise<ImportResult> {
  ensureNotCancelled(input)
  const result: ImportResult = {index: input.index, total: input.rows.length, success: 0, failed: 0, failures: []}
  if (input.rows.length === 0) return result
  // A missing schema or rejected credentials are request failures, not row
  // failures. Resolve once before any destructive mutation.
  const uniqueKey = await getUniqueKey(connection, input.index, input.signal)
  if (!uniqueKey) throw new SearchEngineError({engineType: 'solr', code: 'unsupported_capability', message: '该 Solr Schema 未定义 uniqueKey，无法安全导入文档。'})
  let replaced = false
  for (let offset = 0; offset < input.rows.length; offset += 500) {
    ensureNotCancelled(input)
    const batch = input.rows.slice(offset, offset + 500)
    const documents: Record<string, unknown>[] = []
    for (let index = 0; index < batch.length; index++) {
      try {
        documents.push(prepareDocument(uniqueKey, batch[index].source, batch[index].id).document)
      } catch {
        result.failed++
        // Adapter failure lines are zero-based record indexes within the full
        // adapter input. The import service adds its outer batch offset and
        // preserves the same zero-based contract for IPC.
        if (result.failures.length < 20) result.failures.push({line: offset + index, id: batch[index].id, error: '文档 uniqueKey 缺失、无效或与 ID 不一致。'})
      }
    }
    if (documents.length) {
      if (input.mode === 'replace' && !replaced) {
        ensureNotCancelled(input)
        await solrRequest(connection, {method: 'POST', path: resourcePath(input.index) + '/update', body: {delete: {query: '*:*'}}, signal: input.signal})
        replaced = true
      }
      await solrRequest(connection, {method: 'POST', path: resourcePath(input.index) + '/update', body: documents, signal: input.signal})
      result.success += documents.length
    }
    ensureNotCancelled(input)
    input.onBatchProgress?.({success: result.success, failed: result.failed})
  }
  if (input.commitPolicy === 'commit' || input.commitPolicy === 'softCommit') {
    await solrRequest(connection, {method: 'POST', path: resourcePath(input.index) + '/update', body: input.commitPolicy === 'commit' ? {commit: {}} : {commit: {softCommit: true}}, signal: input.signal})
  }
  ensureNotCancelled(input)
  // The service may need to send a later batch in replace mode when this
  // batch contained no schema-valid documents. This explicit marker lets it
  // distinguish Solr's deferred destructive step from legacy adapters whose
  // replace operation is performed before attempting writes.
  return {...result, replaceApplied: replaced}
}

/** cursorMark avoids loading the result set into adapter memory. */
export async function* exportBatches(connection: SearchConnection, input: ExportInput & {signal?: AbortSignal}): AsyncGenerator<DocumentHit[]> {
  ensureNotCancelled(input)
  if (input.queryLanguage && input.queryLanguage !== 'solr') throw new SearchEngineError({engineType: 'solr', code: 'unsupported_capability', message: 'Solr 导出只接受原生查询参数。'})
  if (!Number.isSafeInteger(input.maxRows) || input.maxRows < 0) throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: '导出行数必须是非负整数。'})
  if (input.maxRows === 0) return
  const uniqueKey = await getUniqueKey(connection, input.index, input.signal)
  if (!uniqueKey) throw new SearchEngineError({engineType: 'solr', code: 'unsupported_capability', message: 'Solr 流式导出要求 Schema 定义 uniqueKey。'})
  const query = buildSolrQuery(input.query ?? {})
  const sort = typeof query.sort === 'string' && query.sort.trim()
    ? query.sort.split(',').some(clause => clause.trim().split(/\s+/)[0] === uniqueKey)
      ? query.sort : `${query.sort},${uniqueKey} asc`
    : `${uniqueKey} asc`
  let cursorMark = '*'
  let exported = 0
  while (exported < input.maxRows) {
    ensureNotCancelled(input)
    const raw = await solrRequest<SolrSelectResponse>(connection, {method: 'GET', path: resourcePath(input.index) + '/select',
      query: {...query, start: 0, rows: Math.min(500, input.maxRows - exported), sort, cursorMark}, signal: input.signal})
    if (raw.responseHeader?.partialResults) throw new SearchEngineError({engineType: 'solr', code: 'http_error', message: 'Solr 返回部分结果，已停止导出以避免静默遗漏。'})
    if (!raw.response || !Array.isArray(raw.response.docs)) throw new SearchEngineError({engineType: 'solr', code: 'parse_error', message: 'Solr 导出响应格式无效。'})
    const hits = raw.response.docs.slice(0, input.maxRows - exported).map(doc => mapHit(doc, uniqueKey))
    if (!hits.length) break
    exported += hits.length
    yield hits
    if (!raw.nextCursorMark || raw.nextCursorMark === cursorMark) break
    cursorMark = raw.nextCursorMark
  }
}

export async function exportDocuments(connection: SearchConnection, input: ExportInput & {signal?: AbortSignal}): Promise<ExportResult> {
  const hits: DocumentHit[] = []
  for await (const batch of exportBatches(connection, input)) hits.push(...batch)
  return {index: input.index, hits, total: hits.length}
}

export const solrAdapter: SearchEngineAdapter = {
  type: 'solr', displayName: 'Apache Solr', manifest: solrManifest,
  getCapabilities: () => ({...solrManifest.capabilities}), detect, testConnection,
  listResources, getSchema, queryDocuments, createDocument, updateDocument, deleteDocument,
  importDocuments, exportDocuments, exportBatches
}
