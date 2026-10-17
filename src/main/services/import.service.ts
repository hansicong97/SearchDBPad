import { randomUUID } from 'node:crypto'
import { resolveAdapterByConnectionId } from './searchEngine.service'
import { sendImportProgress } from './jobProgress'
import { clearCancelled, createCancelledError, getJobSignal, isCancelled, isCancelledError, markJobActive, USER_STOPPED_MESSAGE } from './jobCancel.service'
import { readImportRows } from './transferFiles'
import { runWithRequestContext } from '../search/requestContext'
import type { ApiResponse, ImportExecuteRequest, ImportExecuteResult, ImportFormat, ImportPreviewRequest, ImportPreviewResult, ImportPreviewRow, ImportProgress, ImportFailure } from '../../shared/ipc'
import type { ImportRow } from '../search/adapter.types'
import { requireOperation } from '../search/adapter.types'
import { SearchEngineError, toPublicSearchError } from '../search/errors'
import { assertImportFileRequest, assertObject, assertNonEmptyString, assertResourceName, assertCommitPolicy } from './requestValidation'

const IMPORT_BATCH_SIZE = 1000
const SAFE_ROW_FAILURE_MESSAGES = new Set([
  '文档 uniqueKey 缺失、无效或与 ID 不一致。'
])

/** Adapter row failures are another public error surface: server Bulk reasons
 * may contain credentials, scripts or response bodies. Only authored messages
 * may pass through, while source previews come from the user's selected file. */
function safeRowFailure(failure: ImportFailure, offset: number): ImportFailure {
  return {
    // Adapter failure lines and the IPC contract are zero-based. Add the
    // current batch offset while preserving that stable indexing convention.
    line: offset + failure.line,
    id: failure.id,
    error: SAFE_ROW_FAILURE_MESSAGES.has(failure.error)
      ? failure.error
      : '文档导入失败，请检查文档格式、字段类型和写入权限',
    raw: failure.raw
  }
}

const IMPORT_VALIDATION_MESSAGES: Record<string, string> = {
  '导入文档必须是 JSON 对象': '导入文档必须是 JSON 对象',
  'CSV 引号格式无效': 'CSV 引号格式无效',
  'CSV 引号未闭合': 'CSV 引号未闭合',
  'CSV 数据列数与表头不一致': 'CSV 数据列数与表头不一致',
  'NDJSON Bulk action 行无效': 'NDJSON Bulk action 行无效',
  'NDJSON 导入仅支持 index / create action': 'NDJSON 导入仅支持 index / create action',
  'NDJSON Bulk action 元数据无效': 'NDJSON Bulk action 元数据无效',
  'NDJSON Bulk action 缺少 source 行': 'NDJSON Bulk action 缺少 source 行',
  'JSON 文件顶层必须是数组': 'JSON 文件顶层必须是数组',
  'JSON 数组后存在多余内容': 'JSON 数组后存在多余内容',
  'JSON 数组末尾存在多余逗号': 'JSON 数组末尾存在多余逗号',
  'JSON 数组元素间缺少逗号': 'JSON 数组元素间缺少逗号',
  'JSON 数组未闭合': 'JSON 数组未闭合'
}

function importError(error: unknown, operation: string) {
  const localMessage = error instanceof Error ? IMPORT_VALIDATION_MESSAGES[error.message] : undefined
  return localMessage
    ? { code: 'invalid_request', operation, message: localMessage }
    : toPublicSearchError(error, operation)
}

export function detectFormat(filePath: string): Exclude<ImportFormat, 'auto'> | null {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.ndjson')) return 'ndjson'
  if (lower.endsWith('.csv')) return 'csv'
  return null
}

function resolveFormat(filePath: string, format: ImportFormat): Exclude<ImportFormat, 'auto'> {
  return format === 'auto' ? detectFormat(filePath) ?? 'json' : format
}

export async function importPreview(req: ImportPreviewRequest): Promise<ApiResponse<ImportPreviewResult>> {
  try {
    assertImportFileRequest(req)
    if (!Number.isSafeInteger(req.maxRows) || req.maxRows < 0) throw new TypeError('Invalid preview size')
    const format = resolveFormat(req.filePath, req.format)
    let nativeDocuments = false
    if (req.connectionId !== undefined) {
      assertNonEmptyString(req.connectionId)
      const { adapter } = await resolveAdapterByConnectionId(req.connectionId)
      if (!adapter.manifest.transferFormats.includes(format)) throw new TypeError('Invalid import format')
      nativeDocuments = adapter.manifest.protocolFamily !== 'elasticsearch-rest'
    }
    const rows: ImportPreviewRow[] = []
    const limit = Math.max(0, Math.min(1000, Math.floor(req.maxRows) || 0))
    let totalRows = 0
    for await (const row of readImportRows(req.filePath, format, undefined, nativeDocuments)) {
      totalRows++
      if (rows.length < limit) rows.push(row)
    }
    return { success: true, data: { format, totalRows, rows, warnings: [] } }
  } catch (err) {
    return { success: false, error: importError(err, 'import:preview') }
  }
}

export async function runImport(req: ImportExecuteRequest): Promise<ApiResponse<ImportExecuteResult>> {
  try {
    assertObject(req)
    assertNonEmptyString(req.connectionId)
    assertResourceName(req.index)
    assertImportFileRequest(req)
    assertCommitPolicy(req.commitPolicy)
    if (req.mode !== 'append' && req.mode !== 'replace') throw new TypeError('Invalid import mode')
  } catch (error) { return { success: false, error: importError(error, 'import:run') } }
  const jobId = randomUUID()
  let terminal = false
  let total: number | null = null
  let processed = 0
  let success = 0
  let failed = 0
  const failures: ImportFailure[] = []
  markJobActive(jobId)
  const signal = getJobSignal(jobId)!
  const check = (): void => { if (signal.aborted) throw createCancelledError() }
  const emit = (stage: ImportProgress['stage'], message?: string): void => {
    if (terminal) return
    terminal = stage === 'completed' || stage === 'cancelled' || stage === 'failed'
    sendImportProgress({ jobId, stage, total, processed, success, failed,
      percent: total === null ? null : total === 0 ? 100 : Math.min(100, Math.round(processed / total * 100)), message })
  }
  try {
    return await runWithRequestContext({ signal, jobId }, async () => {
      emit('reading')
      check()
      const format = resolveFormat(req.filePath, req.format)
      const { connection, adapter } = await resolveAdapterByConnectionId(req.connectionId)
      check()
      if (!adapter.manifest.transferFormats.includes(format)) {
        throw new SearchEngineError({
          engineType: connection.engineType,
          code: 'unsupported_capability',
          message: '当前引擎不支持此导入格式'
        })
      }
      const importDocuments = requireOperation(adapter, 'importDocuments')
      const nativeDocuments = adapter.manifest.protocolFamily !== 'elasticsearch-rest'

      // Validate all records before replace can erase existing data. Both passes
      // hold only one record / batch, even for large source files.
      let count = 0
      for await (const _row of readImportRows(req.filePath, format, signal, nativeDocuments)) {
        count++
        if (count % IMPORT_BATCH_SIZE === 0) { check(); emit('parsing') }
      }
      total = count
      emit('parsing')
      check()
      let batch: ImportRow[] = []
      // Keep replace pending until the adapter confirms at least one accepted
      // row. Solr validates rows against Schema before clearing existing data,
      // so an all-invalid batch must not consume the replace operation.
      let replacePending = req.mode === 'replace'
      const flush = async (): Promise<void> => {
        if (batch.length === 0) return
        check()
        const offset = processed
        const oldSuccess = success
        const oldFailed = failed
        if (replacePending) emit('clearing')
        emit('writing')
        const result = await importDocuments(connection, {
          index: req.index, rows: batch, mode: replacePending ? 'replace' : 'append', signal,
          commitPolicy: req.commitPolicy,
          isCancelled: () => signal.aborted,
          onBatchProgress: (progress) => {
            check()
            success = oldSuccess + progress.success
            failed = oldFailed + progress.failed
            processed = offset + progress.success + progress.failed
            emit('writing')
          }
        })
        check()
        success = oldSuccess + result.success
        failed = oldFailed + result.failed
        processed = offset + batch.length
        for (const failure of result.failures) {
          if (failures.length === 20) break
          failures.push(safeRowFailure(failure, offset))
        }
        if (replacePending) {
          // Solr reports whether it actually performed its deferred delete.
          // Adapters without this marker retain the historical contract that
          // replace is completed by their first call, even if every row fails.
          const replaceApplied = result.replaceApplied
          replacePending = replaceApplied === false
        }
        batch = []
        emit('writing')
      }
      for await (const row of readImportRows(req.filePath, format, signal, nativeDocuments)) {
        check()
        batch.push({ id: row.id, source: row.source })
        if (batch.length === IMPORT_BATCH_SIZE) await flush()
      }
      await flush()
      check()
      emit('completed', `导入完成：成功 ${success}，失败 ${failed}`)
      return { success: true, data: { jobId, connectionId: req.connectionId, index: req.index, format, total: processed, success, failed, failures } }
    })
  } catch (err) {
    const cancelled = isCancelledError(err) || isCancelled(jobId)
    const error = cancelled
      ? { code: 'cancelled', operation: 'import:run', message: USER_STOPPED_MESSAGE }
      : importError(err, 'import:run')
    emit(cancelled ? 'cancelled' : 'failed', error.message)
    return { success: false, error }
  } finally {
    clearCancelled(jobId)
  }
}
