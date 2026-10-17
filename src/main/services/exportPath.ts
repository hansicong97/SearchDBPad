import path from 'node:path'
import type { ExportFormat } from '../../shared/ipc'

export const EXPORT_FORMATS: readonly ExportFormat[] = ['json', 'ndjson', 'csv']

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value)
}

/** Convert a resource name into a safe default file-name stem. */
export function sanitizeExportFileStem(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  let stem = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 120)

  if (!stem) stem = 'export'
  // Windows reserves these device names even when an extension is present.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(stem)) {
    stem = `_${stem}`
  }
  return stem
}

/** Validate a path supplied to the main process before opening or renaming it. */
export function isUsableExportPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) return false
  if (/[\u0000-\u001f]/.test(value) || /[\\/]$/.test(value)) return false
  const normalized = path.normalize(value)
  const parsed = path.parse(normalized)
  return path.basename(normalized) !== '' && normalized !== parsed.root
}

/** Stable per-window key for paths returned by the native save dialog. */
export function exportPathKey(value: string): string {
  const normalized = path.normalize(path.resolve(value))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
