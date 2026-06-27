/**
 * Import service.
 *
 * V0.3.0: file IO + format parsing stay here (JSON / NDJSON / CSV).
 *  The adapter handles the actual `POST /_bulk` write — see
 *  `src/main/adapters/elasticsearch/importApi.ts`. This split keeps
 *  file IO concerns out of the engine layer (per spec §9.5).
 *
 *  Trade-off: in `replace` mode, the adapter does the wipe
 *  (`_delete_by_query`) before the bulk call. We can't distinguish
 *  wipe-failure from bulk-failure from the service side, so any
 *  adapter throw in `replace` mode is surfaced as the
 *  "清空索引失败" message the old SDK path produced. Other modes
 *  get a generic error.
 */

import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolveAdapterByConnectionId } from './searchEngine.service'
import { sendImportProgress } from './jobProgress'
import type {
  ApiResponse,
  ImportExecuteRequest,
  ImportExecuteResult,
  ImportFormat,
  ImportPreviewRequest,
  ImportPreviewResult,
  ImportPreviewRow
} from '../../shared/ipc'
import type { ImportInput } from '../search/adapter.types'

/* ------------------- File format helpers ------------------- */

interface ParsedRow {
  id?: string
  source: Record<string, unknown>
  raw?: string
}

interface ParsedFile {
  rows: ParsedRow[]
  warnings: string[]
}

/** Detect format from extension. Caller may override via `format` arg. */
function detectFormat(
  filePath: string
): Exclude<ImportFormat, 'auto'> | null {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.ndjson')) return 'ndjson'
  if (lower.endsWith('.csv')) return 'csv'
  return null
}

/** Strip UTF-8 BOM if present at the start of the buffer. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Split non-empty lines, preserving the original text for failure
 *  reporting. Trailing empty lines are dropped. */
function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.length > 0)
}

/** True when the line is a Bulk action metadata line. NDJSON Bulk files
 *  alternate such lines with source lines. The parser accepts
 *  `index` / `create` / `update` / `delete` here, but
 *  `runImport` re-emits every row as an `index` action — `create` /
 *  `update` / `delete` semantics are NOT preserved on the way out. */
function isBulkActionLine(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const keys = Object.keys(obj)
  if (keys.length !== 1) return false
  const k = keys[0]
  return k === 'index' || k === 'create' || k === 'update' || k === 'delete'
}

/** Minimal RFC 4180 CSV parser. Handles quoted fields with embedded
 *  commas / newlines / quotes. Returns one record per non-empty line. */
function parseCsv(text: string): { rows: ParsedRow[]; warning?: string } {
  const rows: string[][] = []
  let i = 0
  const len = text.length
  let field = ''
  let row: string[] = []
  let inQuotes = false
  while (i < len) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      // Treat \r\n or lone \r as a row terminator.
      if (text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  // Flush the last field/row if the file does not end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  if (rows.length === 0) return { rows: [] }

  const headers = rows[0]
  const out: ParsedRow[] = []
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]
    // Skip blank rows (e.g. trailing empty line that survived the split).
    if (cols.length === 1 && cols[0] === '') continue
    const source: Record<string, unknown> = {}
    for (let c = 0; c < headers.length; c++) {
      source[headers[c]] = cols[c] ?? ''
    }
    out.push({ source, raw: rows[r].join(',') })
  }
  return {
    rows: out,
    warning:
      headers.length > 0 && rows.length > 1
        ? undefined
        : 'CSV 只有表头没有数据行'
  }
}

/** Parse a JSON array file. Supports both `[{_id, _source}]` and
 *  plain `[{...}]` shapes; mixed shapes are tolerated by treating any
 *  top-level non-`_id` / non-`_source` key as part of the source. */
function parseJsonArray(text: string): ParsedFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(
      `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!Array.isArray(parsed)) {
    throw new Error('JSON 文件顶层必须是数组')
  }
  const rows: ParsedRow[] = parsed.map((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`第 ${idx + 1} 项不是对象`)
    }
    const obj = item as Record<string, unknown>
    if ('_source' in obj && obj._source && typeof obj._source === 'object') {
      return {
        id: typeof obj._id === 'string' ? obj._id : undefined,
        source: obj._source as Record<string, unknown>,
        raw: JSON.stringify(obj)
      }
    }
    // Plain object — whole thing is the source.
    return {
      id: typeof obj._id === 'string' ? obj._id : undefined,
      source: obj,
      raw: JSON.stringify(obj)
    }
  })
  return { rows, warnings: [] }
}

/** Parse an NDJSON file. Supports both Bulk-format (alternating
 *  action + source lines) and plain-document format (one source per
 *  line). Auto-detected from the first non-empty line. */
function parseNdjson(text: string): ParsedFile {
  const lines = splitLines(text)
  if (lines.length === 0) return { rows: [], warnings: [] }

  let firstParsed: unknown
  try {
    firstParsed = JSON.parse(lines[0])
  } catch (err) {
    throw new Error(
      `NDJSON 第 1 行解析失败：${err instanceof Error ? err.message : String(err)}`
    )
  }
  const bulkFormat = isBulkActionLine(firstParsed)

  const rows: ParsedRow[] = []
  const warnings: string[] = []
  if (bulkFormat) {
    let i = 0
    while (i < lines.length) {
      const actionLine = lines[i]
      let action: Record<string, unknown>
      try {
        action = JSON.parse(actionLine) as Record<string, unknown>
      } catch (err) {
        throw new Error(
          `NDJSON 第 ${i + 1} 行（action）解析失败：${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
      const sourceLine = lines[i + 1]
      if (sourceLine === undefined) {
        throw new Error(`NDJSON 第 ${i + 1} 行（action）缺少对应的 source 行`)
      }
      let source: Record<string, unknown>
      try {
        source = JSON.parse(sourceLine) as Record<string, unknown>
      } catch (err) {
        throw new Error(
          `NDJSON 第 ${i + 2} 行（source）解析失败：${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
      const actionMeta = (action.index ?? action.create ?? action.update ?? action.delete) as
        | Record<string, unknown>
        | undefined
      const id = actionMeta && typeof actionMeta._id === 'string' ? actionMeta._id : undefined
      rows.push({ id, source, raw: `${actionLine}\n${sourceLine}` })
      i += 2
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      try {
        const obj = JSON.parse(line) as Record<string, unknown>
        rows.push({ source: obj, raw: line })
      } catch (err) {
        throw new Error(
          `NDJSON 第 ${i + 1} 行解析失败：${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
    }
    if (lines.length >= 2) {
      warnings.push(
        'NDJSON 检测为纯文档格式（每行一个文档），_id 将由 Elasticsearch 自动生成'
      )
    }
  }
  return { rows, warnings }
}

async function readAndParse(
  filePath: string,
  format: ImportFormat
): Promise<ParsedFile> {
  const text = stripBom(await fs.readFile(filePath, 'utf8'))
  if (format === 'csv') {
    const { rows, warning } = parseCsv(text)
    return { rows, warnings: warning ? [warning] : [] }
  }
  if (format === 'json') {
    const warnings: string[] = []
    if (text.trimStart().startsWith('{') && /\r?\n\s*\{/.test(text)) {
      warnings.push(
        'JSON 文件看起来像 NDJSON（多行 JSON 对象），建议改用 NDJSON 格式'
      )
    }
    const parsed = parseJsonArray(text)
    return { rows: parsed.rows, warnings: [...warnings, ...parsed.warnings] }
  }
  return parseNdjson(text)
}

/* ------------------- Preview (no adapter) ------------------- */

export async function importPreview(
  req: ImportPreviewRequest
): Promise<ApiResponse<ImportPreviewResult>> {
  try {
    const format = resolveFormat(req.filePath, req.format)
    const parsed = await readAndParse(req.filePath, format)
    const preview: ImportPreviewRow[] = parsed.rows
      .slice(0, req.maxRows)
      .map((r): ImportPreviewRow => ({
        id: r.id,
        source: r.source,
        raw: r.raw
      }))
    return {
      success: true,
      data: {
        format,
        totalRows: parsed.rows.length,
        rows: preview,
        warnings: parsed.warnings
      }
    }
  } catch (err) {
    return {
      success: false,
      error: {
        message: err instanceof Error ? err.message : String(err)
      }
    }
  }
}

/* ------------------- Execute (adapter) ------------------- */

function resolveFormat(
  filePath: string,
  format: ImportFormat
): Exclude<ImportFormat, 'auto'> {
  if (format !== 'auto') return format
  const detected = detectFormat(filePath)
  return detected ?? 'json'
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function runImport(
  req: ImportExecuteRequest
): Promise<ApiResponse<ImportExecuteResult>> {
  const { connectionId, index, filePath, format, mode } = req
  // V0.3.7 B-3: every import gets a jobId so the renderer can
  // correlate progress events with the final result. We always
  // emit a terminal `completed` or `failed` event, even if the
  // job threw on the first stage — that way the renderer can
  // close its loading state no matter where the error came from.
  const jobId = randomUUID()
  const emit = (
    stage: 'reading' | 'parsing' | 'clearing' | 'writing' | 'completed' | 'failed',
    patch: {
      percent?: number | null
      total?: number | null
      processed?: number | null
      success?: number
      failed?: number
      message?: string
    }
  ): void => {
    sendImportProgress({
      jobId,
      stage,
      percent: patch.percent ?? null,
      total: patch.total ?? null,
      processed: patch.processed ?? null,
      success: patch.success ?? 0,
      failed: patch.failed ?? 0,
      message: patch.message
    })
  }
  try {
    emit('reading', { percent: null, total: null, processed: null })

    const resolvedFormat = resolveFormat(filePath, format)
    const parsed = await readAndParse(filePath, resolvedFormat)
    const total = parsed.rows.length

    emit('parsing', { percent: 100, total, processed: total })

    const { connection, adapter } = await resolveAdapterByConnectionId(
      connectionId
    )

    const adapterInput: ImportInput = {
      index,
      rows: parsed.rows.map((r) => ({ id: r.id, source: r.source })),
      mode,
      // V0.3.7 B-3: forward batch-level success/failed counters
      // from the adapter so the renderer can update the progress
      // bar after each `_bulk` batch.
      onBatchProgress: ({ success, failed }) => {
        const processed = success + failed
        emit('writing', {
          percent: total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : null,
          total,
          processed,
          success,
          failed
        })
      }
    }

    // Tell the renderer we're about to start writing. The
    // `clearing` stage only fires for `replace` mode — it covers
    // the `_delete_by_query` round-trip the adapter makes first.
    if (mode === 'replace' && total > 0) {
      emit('clearing', { percent: 0, total, processed: 0 })
    }
    emit('writing', { percent: 0, total, processed: 0 })

    let result
    try {
      result = await adapter.importDocuments(connection, adapterInput)
    } catch (err) {
      // In `replace` mode the adapter does the wipe before the bulk
      // call; we can't tell which step failed from the service side,
      // but the legacy SDK surfaced the same wording for the wipe
      // case, so we preserve that.
      if (mode === 'replace') {
        const msg = `清空索引 "${index}" 失败：${errMsg(err)}`
        emit('failed', {
          percent: null,
          total,
          processed: null,
          message: msg
        })
        return {
          success: false,
          error: { message: msg }
        }
      }
      throw err
    }

    emit('completed', {
      percent: 100,
      total,
      processed: total,
      success: result.success,
      failed: result.failed,
      message: `导入完成：成功 ${result.success}，失败 ${result.failed}`
    })

    return {
      success: true,
      data: {
        jobId,
        connectionId,
        index,
        format: resolvedFormat,
        total: result.total,
        success: result.success,
        failed: result.failed,
        failures: result.failures
      }
    }
  } catch (err) {
    const msg = errMsg(err)
    emit('failed', {
      percent: null,
      total: null,
      processed: null,
      message: msg
    })
    return {
      success: false,
      error: { message: msg }
    }
  }
}

export { detectFormat }