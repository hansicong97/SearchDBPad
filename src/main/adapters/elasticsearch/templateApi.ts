/**
 * Index template management (V0.3.4 A-5).
 *
 * Two flavours of "template" coexist in Elasticsearch:
 *  - Legacy templates (ES ≤ 7.7 only; still accepted on 7.8+ as
 *    deprecated): `PUT /_template/{name}` body
 *      `{ index_patterns: [...], settings, mappings, ... }`.
 *  - Composable templates (ES 7.8+): `PUT /_index_template/{name}`
 *    body `{ index_patterns: [...], template: { settings, mappings } }`.
 *
 * The adapter decides which path to take based on the cached
 * server version. Renderer never sees the difference in shape — it
 * always edits the inner `{ index_patterns, settings, mappings }`
 * payload, and the adapter re-wraps under `template` for composable
 * targets.
 *
 * Listing queries BOTH endpoints so a mixed-version / mixed-legacy
 * cluster still returns the full set. The `legacy` flag on each row
 * lets the renderer decide which delete button to wire up.
 */

import { elasticsearchRequest } from './client'
import { detect } from './detector'
import {
  getCachedServerInfo,
  setCachedServerInfo
} from '../../search/serverVersionCache'
import type { SearchConnection } from '../../../shared/searchEngine'
import type {
  IndexTemplateGetResult,
  IndexTemplateListResult,
  IndexTemplateModifyResult
} from '../../../shared/ipc'

/** ES 7.8 introduced composable templates. Anything older only
 *  supports the legacy `/_template` endpoint. */
function isComposableSupported(major: number, minor: number): boolean {
  if (major > 7) return true
  if (major < 7) return false
  return minor >= 8
}

function pickTemplateFlavor(
  info: { major: number; minor: number },
  hint?: boolean
): 'legacy' | 'composable' {
  if (hint === true) return 'legacy'
  if (hint === false) return 'composable'
  return isComposableSupported(info.major, info.minor)
    ? 'composable'
    : 'legacy'
}

interface LegacyTemplateRecord {
  [name: string]: {
    index_patterns?: unknown
    settings?: unknown
    mappings?: unknown
    [k: string]: unknown
  }
}

interface ComposableTemplateRecord {
  index_templates?: Array<{
    name: string
    index_template: {
      index_patterns?: unknown
      template?: { settings?: unknown; mappings?: unknown; [k: string]: unknown }
      [k: string]: unknown
    }
  }>
}

export async function listIndexTemplates(
  connection: SearchConnection
): Promise<IndexTemplateListResult> {
  let info = getCachedServerInfo(connection.id)
  if (!info) {
    info = await detect(connection)
    setCachedServerInfo(connection.id, info)
  }

  const composable =
    isComposableSupported(info.major, info.minor) ||
    // Some clusters have legacy templates disabled but composable
    // templates enabled even on older minors — we probe both to be
    // safe and dedupe by name below.
    true

  const results: IndexTemplateListResult['templates'] = []
  const seen = new Set<string>()

  if (composable) {
    try {
      const record = await elasticsearchRequest<ComposableTemplateRecord>(
        connection,
        { method: 'GET', path: '/_index_template' }
      )
      for (const t of record.index_templates ?? []) {
        if (!seen.has(t.name)) {
          seen.add(t.name)
          results.push({ name: t.name, legacy: false })
        }
      }
    } catch {
      // Older clusters 404 on this path — silently ignore so the
      // legacy probe below can still return data.
    }
  }

  try {
    const record = await elasticsearchRequest<LegacyTemplateRecord>(
      connection,
      { method: 'GET', path: '/_template' }
    )
    for (const name of Object.keys(record ?? {})) {
      if (!seen.has(name)) {
        seen.add(name)
        results.push({ name, legacy: true })
      }
    }
  } catch {
    // ES 8+ may disable the legacy endpoint; ignore.
  }

  results.sort((a, b) => a.name.localeCompare(b.name))
  return { connectionId: connection.id, templates: results }
}

export async function getIndexTemplate(
  connection: SearchConnection,
  name: string
): Promise<IndexTemplateGetResult> {
  let info = getCachedServerInfo(connection.id)
  if (!info) {
    info = await detect(connection)
    setCachedServerInfo(connection.id, info)
  }

  // Prefer composable when the server supports it.
  if (isComposableSupported(info.major, info.minor)) {
    try {
      const record = await elasticsearchRequest<{
        index_templates?: Array<{
          name: string
          index_template: Record<string, unknown>
        }>
      }>(connection, {
        method: 'GET',
        path: `/_index_template/${encodeURIComponent(name)}`
      })
      const found = record.index_templates?.find((t) => t.name === name)
      if (found) {
        return {
          connectionId: connection.id,
          name,
          legacy: false,
          template: found.index_template
        }
      }
    } catch {
      // fall through to legacy
    }
  }

  const record = await elasticsearchRequest<LegacyTemplateRecord>(connection, {
    method: 'GET',
    path: `/_template/${encodeURIComponent(name)}`
  })
  const inner = record?.[name]
  if (!inner) {
    throw new Error(`模板 "${name}" 不存在`)
  }
  return {
    connectionId: connection.id,
    name,
    legacy: true,
    template: inner as Record<string, unknown>
  }
}

export async function createIndexTemplate(
  connection: SearchConnection,
  name: string,
  template: Record<string, unknown>,
  legacy?: boolean
): Promise<IndexTemplateModifyResult> {
  let info = getCachedServerInfo(connection.id)
  if (!info) {
    info = await detect(connection)
    setCachedServerInfo(connection.id, info)
  }
  const flavor = pickTemplateFlavor(info, legacy)
  if (flavor === 'composable') {
    // Compose the `{ template: { settings, mappings } }` wrapper
    // around the renderer's flat payload if it isn't already
    // wrapped. We only auto-wrap when the caller did not supply
    // `template` themselves (advanced use case).
    const body: Record<string, unknown> =
      'template' in template && template.template
        ? { ...template }
        : { ...template, template: { ...stripTopLevelTemplateKeys(template) } }
    await elasticsearchRequest(connection, {
      method: 'PUT',
      path: `/_index_template/${encodeURIComponent(name)}`,
      body
    })
  } else {
    // Legacy: pass through as-is.
    await elasticsearchRequest(connection, {
      method: 'PUT',
      path: `/_template/${encodeURIComponent(name)}`,
      body: template
    })
  }
  return {
    connectionId: connection.id,
    name,
    acknowledged: true
  }
}

export async function deleteIndexTemplate(
  connection: SearchConnection,
  name: string,
  legacy?: boolean
): Promise<IndexTemplateModifyResult> {
  let info = getCachedServerInfo(connection.id)
  if (!info) {
    info = await detect(connection)
    setCachedServerInfo(connection.id, info)
  }
  const flavor = pickTemplateFlavor(info, legacy)
  if (flavor === 'composable') {
    await elasticsearchRequest(connection, {
      method: 'DELETE',
      path: `/_index_template/${encodeURIComponent(name)}`
    })
  } else {
    await elasticsearchRequest(connection, {
      method: 'DELETE',
      path: `/_template/${encodeURIComponent(name)}`
    })
  }
  return {
    connectionId: connection.id,
    name,
    acknowledged: true
  }
}

/** V0.3.4 helper: when auto-wrapping a renderer's flat payload into
 *  composable shape, copy only the keys that belong inside
 *  `template` (`settings`, `mappings`). Other top-level keys like
 *  `index_patterns` / `priority` stay outside. */
function stripTopLevelTemplateKeys(
  flat: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('settings' in flat) out.settings = flat.settings
  if ('mappings' in flat) out.mappings = flat.mappings
  return out
}
