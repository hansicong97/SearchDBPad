import { createReadStream } from 'node:fs'
import type { ImportFormat } from '../../shared/ipc'
import { createCancelledError } from './jobCancel.service'

export interface ParsedRow {
  id?: string
  source: Record<string, unknown>
  raw?: string
}

function objectRow(value: unknown, raw: string, nativeDocuments: boolean): ParsedRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('导入文档必须是 JSON 对象')
  }
  const obj = value as Record<string, unknown>
  if (nativeDocuments) return { source: obj, raw }
  const envelope = obj._source ?? (typeof obj.id === 'string' ? obj.fields : undefined)
  if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
    return { id: typeof obj._id === 'string' ? obj._id : typeof obj.id === 'string' ? obj.id : undefined, source: envelope as Record<string, unknown>, raw }
  }
  return { id: typeof obj._id === 'string' ? obj._id : undefined, source: obj, raw }
}

function csvColumns(record: string): string[] {
  const columns: string[] = []
  let field = ''
  let quoted = false
  let closed = false
  for (let i = 0; i < record.length; i++) {
    const ch = record[i]
    if (quoted) {
      if (ch === '"' && record[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') { quoted = false; closed = true }
      else field += ch
    } else if (ch === ',') { columns.push(field); field = ''; closed = false }
    else if (ch === '"' && field === '' && !closed) quoted = true
    else if (closed || ch === '"') throw new Error('CSV 引号格式无效')
    else field += ch
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  columns.push(field)
  return columns
}

/** Streams records without materializing the file; callers retain only one batch. */
export async function* readImportRows(
  filePath: string, format: Exclude<ImportFormat, 'auto'>, signal?: AbortSignal,
  nativeDocuments = false
): AsyncGenerator<ParsedRow> {
  const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 })
  const check = (): void => { if (signal?.aborted) throw createCancelledError() }
  const abort = (): void => { stream.destroy(createCancelledError()) }
  if (signal?.aborted) { stream.destroy(); throw createCancelledError() }
  signal?.addEventListener('abort', abort, { once: true })
  let record = ''
  let first = true
  let inString = false
  let escaped = false
  let depth = 0
  let started = false
  let ended = false
  let afterValue = false
  let afterComma = false
  let csvQuoted = false
  let csvQuotePending = false
  let skipLf = false
  let headers: string[] | undefined
  let action: { id?: string; raw: string } | undefined
  let bulk: boolean | undefined
  const parseRecord = (raw: string): ParsedRow | undefined => {
    if (format === 'csv') {
      if (raw === '') return undefined
      const columns = csvColumns(raw)
      if (!headers) { headers = columns; return undefined }
      if (columns.length !== headers.length) throw new Error('CSV 数据列数与表头不一致')
      const source = Object.fromEntries(headers.map((key, i) => [key, columns[i]]))
      if (nativeDocuments) return { source, raw }
      const id = source._id || undefined
      delete source._id
      return { id, source, raw }
    }
    if (raw.trim() === '') return undefined
    const parsed: unknown = JSON.parse(raw)
    const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
    const key = obj && Object.keys(obj).length === 1 ? Object.keys(obj)[0] : undefined
    const isAction = key !== undefined && ['index', 'create', 'update', 'delete'].includes(key)
    if (bulk === undefined) bulk = isAction
    if (!bulk) return objectRow(parsed, raw, nativeDocuments)
    if (!action) {
      if (!isAction || !key) throw new Error('NDJSON Bulk action 行无效')
      if (key === 'update' || key === 'delete') throw new Error('NDJSON 导入仅支持 index / create action')
      const meta = obj![key]
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('NDJSON Bulk action 元数据无效')
      const id = (meta as Record<string, unknown>)._id
      action = { id: typeof id === 'string' ? id : undefined, raw }
      return undefined
    }
    const row = objectRow(parsed, raw, nativeDocuments)
    const result = { id: action.id, source: row.source, raw: action.raw + '\n' + raw }
    action = undefined
    return result
  }
  try {
    for await (const part of stream) {
      check()
      let chunk = String(part)
      if (first) { chunk = chunk.replace(/^\uFEFF/, ''); first = false }
      for (const ch of chunk) {
        if (format === 'json') {
          if (!started) {
            if (/\s/.test(ch)) continue
            if (ch !== '[') throw new Error('JSON 文件顶层必须是数组')
            started = true; continue
          }
          if (ended) { if (!/\s/.test(ch)) throw new Error('JSON 数组后存在多余内容'); continue }
          if (depth === 0) {
            if (/\s/.test(ch)) continue
            if (ch === ']') { if (afterComma) throw new Error('JSON 数组末尾存在多余逗号'); ended = true; continue }
            if (afterValue) {
              if (ch !== ',') throw new Error('JSON 数组元素间缺少逗号')
              afterValue = false; afterComma = true; continue
            }
            if (ch !== '{') throw new Error('导入文档必须是 JSON 对象')
            depth = 1; record = ch; afterComma = false; continue
          }
          record += ch
          if (inString) {
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === '"') inString = false
          } else if (ch === '"') inString = true
          else if (ch === '{' || ch === '[') depth++
          else if (ch === '}' || ch === ']') {
            depth--
            if (depth === 0) {
              yield objectRow(JSON.parse(record), record, nativeDocuments)
              record = ''; afterValue = true
            }
          }
          continue
        }
        if (skipLf) { skipLf = false; if (ch === '\n') continue }
        if (format === 'csv') {
          if (csvQuotePending) {
            csvQuotePending = false
            if (ch === '"') { record += ch; continue }
            csvQuoted = false
          }
          if (ch === '"') {
            if (csvQuoted) csvQuotePending = true
            else csvQuoted = true
            record += ch; continue
          }
        }
        if ((ch === '\n' || ch === '\r') && !csvQuoted) {
          const row = parseRecord(record); record = ''; skipLf = ch === '\r'
          if (row) yield row
        } else record += ch
      }
    }
    check()
    if (format === 'json') { if (!ended || depth !== 0) throw new Error('JSON 数组未闭合') }
    else {
      if (format === 'csv' && csvQuoted && !csvQuotePending) throw new Error('CSV 引号未闭合')
      const row = parseRecord(record)
      if (row) yield row
      if (action) throw new Error('NDJSON Bulk action 缺少 source 行')
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    stream.destroy()
  }
}
