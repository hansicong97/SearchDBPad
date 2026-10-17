import { promises as fs, createReadStream } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { finished } from 'node:stream/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveAdapterByConnectionId } from './searchEngine.service'
import { sendExportProgress } from './jobProgress'
import { clearCancelled, createCancelledError, getJobSignal, isCancelled, isCancelledError, markJobActive, USER_STOPPED_MESSAGE } from './jobCancel.service'
import { runWithRequestContext } from '../search/requestContext'
import { requireOperation } from '../search/adapter.types'
import type { ApiResponse, DocumentHit, ExportRequest, ExportResult, ExportProgress } from '../../shared/ipc'
import { MAX_EXPORT_ROWS } from '../../shared/ipc'
import type { ExportInput } from '../search/adapter.types'
import { SearchEngineError, toPublicSearchError } from '../search/errors'
import { isExportFormat, isUsableExportPath } from './exportPath'

function exportError(error: unknown, operation: string) {
  if (error instanceof TypeError && error.message === '导出数量必须大于 0') {
    return { code: 'invalid_request', operation, message: '导出数量必须大于 0' }
  }
  return toPublicSearchError(error, operation)
}

function csvEscape(value: unknown): string {
  const raw = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

export async function runExport(req: ExportRequest): Promise<ApiResponse<ExportResult>> {
  if (!req || typeof req !== 'object' || !isExportFormat(req.format) ||
      typeof req.connectionId !== 'string' || !req.connectionId.trim() ||
      typeof req.index !== 'string' || !req.index.trim() ||
      !isUsableExportPath(req.outputPath) ||
      !Number.isFinite(req.maxRows) || req.maxRows <= 0) {
    return {
      success: false,
      error: {
        code: 'invalid_request',
        operation: 'export:run',
        message: '请求参数无效，请检查输入'
      }
    }
  }
  const jobId = randomUUID()
  const temporaryPath = path.join(path.dirname(req.outputPath), `.${path.basename(req.outputPath)}.${jobId}.part`)
  const spoolPath = `${temporaryPath}.rows`
  let output: FileHandle | undefined
  let spool: FileHandle | undefined
  let terminal = false
  let rows = 0
  let bytes = 0
  markJobActive(jobId)
  const signal = getJobSignal(jobId)!
  const check = (): void => { if (signal.aborted) throw createCancelledError() }
  const emit = (stage: ExportProgress['stage'], message?: string): void => {
    if (terminal) return
    terminal = stage === 'completed' || stage === 'cancelled' || stage === 'failed'
    sendExportProgress({ jobId, stage, percent: stage === 'completed' ? 100 : null, total: rows, bytes, message })
  }
  const write = async (text: string): Promise<void> => {
    check()
    await output!.writeFile(text, 'utf8')
    bytes += Buffer.byteLength(text)
    check()
  }
  try {
    return await runWithRequestContext({ signal, jobId }, async () => {
      emit('querying')
      if (!Number.isFinite(req.maxRows) || req.maxRows <= 0) throw new TypeError('导出数量必须大于 0')
      const maxRows = Math.min(Math.floor(req.maxRows), MAX_EXPORT_ROWS)
      check()
      const { connection, adapter } = await resolveAdapterByConnectionId(req.connectionId)
      if (!adapter.manifest.transferFormats.includes(req.format)) {
        throw new SearchEngineError({
          engineType: connection.engineType,
          code: 'unsupported_capability',
          message: '当前引擎不支持此导出格式'
        })
      }
      const input: ExportInput = { index: req.index, maxRows, query: req.query, queryLanguage: req.queryLanguage, signal, isCancelled: () => signal.aborted }
      const batches: AsyncIterable<DocumentHit[]> = adapter.exportBatches
        ? requireOperation(adapter, 'exportBatches')(connection, input)
        : (async function* () { yield (await requireOperation(adapter, 'exportDocuments')(connection, input)).hits })()
      check()
      await fs.mkdir(path.dirname(req.outputPath), { recursive: true })
      output = await fs.open(temporaryPath, 'wx')
      const csvKeys = new Set<string>()
      const elasticsearchFormat = adapter.manifest.protocolFamily === 'elasticsearch-rest'
      if (req.format === 'json') await write('[\n')
      if (req.format === 'csv') spool = await fs.open(spoolPath, 'wx')
      for await (const batch of batches) {
        check()
        emit('writing')
        for (const hit of batch) {
          if (rows >= maxRows) break
          check()
          if (req.format === 'csv') {
            for (const key of Object.keys(hit.fields)) csvKeys.add(key)
            await spool!.writeFile(JSON.stringify({ id: hit.id, fields: hit.fields }) + '\n', 'utf8')
          } else if (req.format === 'json') {
            const doc = elasticsearchFormat ? { _id: hit.id, _source: hit.fields } : hit.fields
            await write((rows > 0 ? ',\n' : '') + JSON.stringify(doc))
          } else {
            await write(JSON.stringify({ index: { _index: req.index, _id: hit.id } }) + '\n' + JSON.stringify(hit.fields) + '\n')
          }
          rows++
        }
        emit('writing')
        if (rows >= maxRows) break
      }
      check()
      if (req.format === 'json') await write('\n]\n')
      if (req.format === 'csv') {
        await spool!.close(); spool = undefined
        const keys = [...csvKeys].sort()
        const includeId = elasticsearchFormat
        await write('\uFEFF' + (includeId ? ['_id', ...keys] : keys).map(csvEscape).join(',') + '\r\n')
        const reader = createReadStream(spoolPath, { encoding: 'utf8' })
        const lines = createInterface({ input: reader, crlfDelay: Infinity })
        const abort = (): void => { reader.destroy(createCancelledError()) }
        signal.addEventListener('abort', abort, { once: true })
        try {
          for await (const line of lines) {
            check()
            const hit = JSON.parse(line) as DocumentHit
            const values = includeId ? [hit.id, ...keys.map((key) => hit.fields[key])] : keys.map((key) => hit.fields[key])
            await write(values.map(csvEscape).join(',') + '\r\n')
          }
        } finally {
          signal.removeEventListener('abort', abort)
          lines.close()
          reader.destroy()
          await finished(reader).catch(() => undefined)
        }
      }
      check()
      await output!.close(); output = undefined
      check()
      // Commit only a complete file. Failure and cancellation preserve an existing destination.
      await fs.rename(temporaryPath, req.outputPath)
      emit('completed', `已导出 ${rows} 条 (${(bytes / 1024).toFixed(1)} KB)`)
      return { success: true, data: { jobId, connectionId: req.connectionId, index: req.index, format: req.format, outputPath: req.outputPath, rows, bytes } }
    })
  } catch (err) {
    const cancelled = isCancelledError(err) || isCancelled(jobId)
    const error = cancelled
      ? { code: 'cancelled', operation: 'export:run', message: USER_STOPPED_MESSAGE }
      : exportError(err, 'export:run')
    const message = error.message
    emit(cancelled ? 'cancelled' : 'failed', message)
    return { success: false, error }
  } finally {
    await output?.close().catch(() => undefined)
    await spool?.close().catch(() => undefined)
    await Promise.all([fs.rm(temporaryPath, { force: true }).catch(() => undefined), fs.rm(spoolPath, { force: true }).catch(() => undefined)])
    clearCancelled(jobId)
  }
}
