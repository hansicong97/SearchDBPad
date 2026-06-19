/**
 * Export service (phase 8).
 *
 * Runs in the Electron main process — the only place allowed to talk to
 * Elasticsearch and to write files. Phase 8 scope:
 *
 *   - One-shot `POST /{index}/_search` capped at `MAX_EXPORT_ROWS` rows.
 *     Scroll / search_after based bulk export is intentionally NOT here
 *     (see ai-dev-steps/08_EXPORT.md MVP limits).
 *   - Three formats: JSON, NDJSON (Bulk-API-compatible), CSV.
 *   - UTF-8 BOM prefix on CSV so Excel on Windows renders Chinese
 *     correctly (otherwise it interprets the file as system codepage).
 *
 * The renderer never sees the filesystem; `outputPath` is chosen via
 * `dialog.showSaveDialog` from the main process.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildEsClient, resolveConnection } from './esClient'
import type {
  ApiResponse,
  DocumentHit,
  ExportFormat,
  ExportRequest,
  ExportResult
} from '../../shared/ipc'
import { MAX_EXPORT_ROWS } from '../../shared/ipc'

interface EsSearchResponseShape {
  hits?: {
    hits?: Array<{
      _index?: string
      _id?: string
      _score?: number | null
      _source?: Record<string, unknown> | null
    }>
  }
}

function describeExportError(err: unknown, index: string): string {
  if (err && typeof err === 'object' && 'meta' in err) {
    const meta = (err as { meta?: { statusCode?: number } }).meta
    if (meta?.statusCode === 404) {
      return `索引 "${index}" 不存在`
    }
    if (meta?.statusCode === 400) {
      return `DSL 无效或索引名非法: ${index}`
    }
  }
  return err instanceof Error ? err.message : String(err)
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
    return JSON.stringify(
      hits.map((h) => ({ _id: h._id, _source: h._source })),
      null,
      2
    ) + '\n'
  }
  if (format === 'ndjson') {
    // Bulk-API-compatible: alternating action line + source line, no
    // surrounding array, no commas, no trailing newline at EOF (the last
    // newline is fine — Bulk readers tolerate it).
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
      const v = h._source && typeof h._source === 'object' ? h._source[k] : undefined
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
    const conn = resolveConnection(connectionId)
    const client = buildEsClient(conn)
    const body: Record<string, unknown> = {
      // `track_total_hits: true` so the caller can show "exported N of M"
      // in a follow-up (currently we just report `rows`).
      track_total_hits: true,
      size: maxRows,
      // `match_all` if no DSL body was supplied.
      query: query ?? { match_all: {} }
    }
    const response = (await client.search({
      index,
      ...body
    } as Parameters<typeof client.search>[0])) as unknown as EsSearchResponseShape

    const rawHits = Array.isArray(response.hits?.hits)
      ? response.hits!.hits!
      : []
    const hits: DocumentHit[] = rawHits.map((h) => ({
      _id: h._id ?? '',
      _index: h._index ?? index,
      _score: typeof h._score === 'number' ? h._score : null,
      _source: (h._source ?? null) as Record<string, unknown> | null
    }))

    let payload = formatHits(hits, format, index)
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
        rows: hits.length,
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