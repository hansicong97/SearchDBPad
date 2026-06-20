/**
 * Export service.
 *
 * V0.3.0: the adapter handles `POST /_search` and returns engine-native
 *  hits. Format serialization (JSON / NDJSON / CSV) and file write
 *  stay here — per spec §9.5, different engines can share file IO
 *  but writing semantics differ.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveAdapterByConnectionId } from './searchEngine.service'
import type {
  ApiResponse,
  DocumentHit,
  ExportFormat,
  ExportRequest,
  ExportResult
} from '../../shared/ipc'
import { MAX_EXPORT_ROWS } from '../../shared/ipc'
import type { ExportInput } from '../search/adapter.types'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function describeExportError(err: unknown, index: string): string {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: number }).status
    if (status === 404) return `索引 "${index}" 不存在`
    if (status === 400) return `DSL 无效或索引名非法: ${index}`
  }
  return errMsg(err)
}

/** Build a JSON-safe value for CSV cells. Objects/arrays become their
 *  JSON representation; everything else is coerced to string. We never
 *  emit `undefined` or functions — both would corrupt the file. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** CSV escape: wrap in double quotes when the cell contains a quote,
 *  comma, newline, or carriage return. Embedded quotes are doubled. */
function csvEscape(raw: string): string {
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

/** Convert an array of hits to one of the supported formats. Returns the
 *  serialized string (UTF-8) ready to write. */
function formatHits(
  hits: DocumentHit[],
  format: ExportFormat,
  index: string
): string {
  if (format === 'json') {
    // Per spec: array of `{ _id, _source }`. Pretty-printed for
    // human-readable output; the file is meant for round-tripping
    // through phase 9's JSON import path.
    return (
      JSON.stringify(
        hits.map((h) => ({ _id: h._id, _source: h._source })),
        null,
        2
      ) + '\n'
    )
  }
  if (format === 'ndjson') {
    // Bulk-API-compatible: alternating action line + source line, no
    // surrounding array, no commas, no trailing newline at EOF (the
    // last newline is fine — Bulk readers tolerate it).
    const lines: string[] = []
    for (const h of hits) {
      lines.push(JSON.stringify({ index: { _index: index, _id: h._id } }))
      lines.push(JSON.stringify(h._source ?? {}))
    }
    return lines.length > 0 ? lines.join('\n') + '\n' : ''
  }
  // csv
  return formatCsv(hits)
}

/** CSV: union of all top-level keys across every `_source`, sorted
 *  alphabetically for stable output. `_id` is added as the first column.
 *  Nested objects / arrays are JSON-stringified. UTF-8 BOM is prepended
 *  in `runExport` (file write layer). */
function formatCsv(hits: DocumentHit[]): string {
  const keySet = new Set<string>()
  for (const h of hits) {
    if (h._source && typeof h._source === 'object') {
      for (const k of Object.keys(h._source)) keySet.add(k)
    }
  }
  const keys = Array.from(keySet).sort()
  const headers = ['_id', ...keys]
  const headerLine = headers.map(csvEscape).join(',')
  const lines: string[] = [headerLine]
  for (const h of hits) {
    const row: string[] = [csvEscape(h._id)]
    for (const k of keys) {
      const v =
        h._source && typeof h._source === 'object' ? h._source[k] : undefined
      row.push(csvEscape(csvCell(v)))
    }
    lines.push(row.join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

export async function runExport(
  req: ExportRequest
): Promise<ApiResponse<ExportResult>> {
  const { connectionId, index, format, outputPath, query } = req
  const requested = req.maxRows
  if (!Number.isFinite(requested) || requested <= 0) {
    return {
      success: false,
      error: { message: '导出数量必须大于 0' }
    }
  }
  const maxRows = Math.min(Math.floor(requested), MAX_EXPORT_ROWS)

  try {
    const { connection, adapter } = await resolveAdapterByConnectionId(
      connectionId
    )

    const adapterInput: ExportInput = { index, maxRows, query }
    const result = await adapter.exportDocuments(connection, adapterInput)

    let payload = formatHits(result.hits, format, index)
    // CSV only: prepend UTF-8 BOM so Excel auto-detects encoding and
    // does not garble Chinese (and other non-ASCII) text.
    if (format === 'csv' && payload.length > 0) {
      payload = '\uFEFF' + payload
    }

    // Make sure the parent directory exists — `showSaveDialog` should
    // give us a writable path, but a custom prompt could pick anything.
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, payload, 'utf8')
    const stat = await fs.stat(outputPath)

    return {
      success: true,
      data: {
        connectionId,
        index,
        format,
        outputPath,
        rows: result.hits.length,
        bytes: stat.size
      }
    }
  } catch (err) {
    return {
      success: false,
      error: { message: describeExportError(err, index) }
    }
  }
}