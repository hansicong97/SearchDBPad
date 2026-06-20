/**
 * Bulk import — V0.3.0 §8.4.3.
 *
 *  The service layer hands us a `rows: ImportRow[]` (already parsed
 *  out of JSON / NDJSON / CSV). The adapter's job is to ship them to
 *  ES in NDJSON batches via `POST /_bulk` and aggregate the per-item
 *  results.
 *
 *  ES-version note: the Bulk API path (`POST /_bulk`) is identical
 *  across 6.x / 7.x / 8.x / 9.x — the per-batch content type is
 *  `application/x-ndjson` and the body alternates action / source
 *  lines. No version branching needed here.
 */

import { elasticsearchRequest } from './client'
import type { SearchConnection } from '../../../shared/searchEngine'
import type {
  ImportFailure,
  ImportInput,
  ImportResult
} from '../../search/adapter.types'

/** Keep partial-failure surfaces small and timeouts predictable. ES
 *  itself tolerates much larger batches (5-15 MB worth). */
const BULK_BATCH_SIZE = 1000

/** Cap on per-row raw text echoed back in `ImportFailure.raw`. */
const RAW_FAILURE_PREVIEW = 500

/** Cap on the failures array returned to the renderer. */
const FAILURES_LIMIT = 20

interface BulkItemResponse {
  index?: {
    _id?: string
    status?: number
    error?: { type?: string; reason?: string }
  }
}

interface BulkResponseShape {
  errors?: boolean
  items?: BulkItemResponse[]
}

function truncate(s: string | undefined, n: number): string | undefined {
  if (s === undefined) return undefined
  return s.length <= n ? s : s.slice(0, n) + '…'
}

/** `replace` mode: wipe the index's existing docs first. Failures
 *  here MUST short-circuit the import — the spec calls this out to
 *  avoid partial success. */
async function clearIndexForReplace(
  connection: SearchConnection,
  index: string
): Promise<void> {
  await elasticsearchRequest(connection, {
    method: 'POST',
    path: `/${index}/_delete_by_query`,
    query: { refresh: 'true', conflicts: 'proceed' },
    body: { query: { match_all: {} } }
  })
}

async function refreshIndex(
  connection: SearchConnection,
  index: string
): Promise<void> {
  try {
    await elasticsearchRequest(connection, {
      method: 'POST',
      path: `/${index}/_refresh`
    })
  } catch {
    /* best-effort — the user can hit refresh manually */
  }
}

export async function importDocuments(
  connection: SearchConnection,
  input: ImportInput
): Promise<ImportResult> {
  const total = input.rows.length

  if (input.mode === 'replace' && total > 0) {
    // Surface wipe failures via the normal SearchEngineError path —
    // the service will translate to ApiResponse.error.
    await clearIndexForReplace(connection, input.index)
  }

  if (total === 0) {
    if (input.mode === 'replace') {
      await refreshIndex(connection, input.index)
    }
    return {
      index: input.index,
      total: 0,
      success: 0,
      failed: 0,
      failures: []
    }
  }

  let success = 0
  let failed = 0
  const failures: ImportFailure[] = []

  for (let start = 0; start < total; start += BULK_BATCH_SIZE) {
    const batch = input.rows.slice(start, start + BULK_BATCH_SIZE)
    const lines: string[] = []
    for (const row of batch) {
      const action: Record<string, unknown> = { _index: input.index }
      if (row.id !== undefined) action._id = row.id
      lines.push(JSON.stringify({ index: action }))
      lines.push(JSON.stringify(row.source))
    }
    const ndjson = lines.join('\n') + '\n'

    const response = await elasticsearchRequest<BulkResponseShape>(
      connection,
      {
        method: 'POST',
        path: '/_bulk',
        ndjsonBody: ndjson
      }
    )

    const items = Array.isArray(response.items) ? response.items : []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const op = item.index
      if (op && op.error) {
        failed++
        if (failures.length < FAILURES_LIMIT) {
          failures.push({
            line: start + i,
            id: typeof op._id === 'string' ? op._id : undefined,
            error:
              op.error.reason ?? op.error.type ?? 'Bulk 项失败（未知原因）',
            raw: truncate(JSON.stringify(batch[i].source), RAW_FAILURE_PREVIEW)
          })
        }
      } else {
        success++
      }
    }
  }

  // Best-effort refresh so the next UI search sees the new docs.
  await refreshIndex(connection, input.index)

  return {
    index: input.index,
    total,
    success,
    failed,
    failures
  }
}