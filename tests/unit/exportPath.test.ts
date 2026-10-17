import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isExportFormat,
  isUsableExportPath,
  sanitizeExportFileStem
} from '../../src/main/services/exportPath'

describe('export path validation', () => {
  it('allowlists formats at runtime', () => {
    expect(isExportFormat('json')).toBe(true)
    expect(isExportFormat('ndjson')).toBe(true)
    expect(isExportFormat('csv')).toBe(true)
    expect(isExportFormat('exe')).toBe(false)
    expect(isExportFormat(undefined)).toBe(false)
  })

  it('sanitizes resource names used in the default save filename', () => {
    const stem = sanitizeExportFileStem('../CON:daily?')
    expect(stem).not.toContain('/')
    expect(stem).not.toContain('\\')
    expect(stem.toLowerCase()).not.toBe('con')
    expect(stem).not.toMatch(/[<>:"|?*]/)
  })

  it('requires an absolute file path and rejects roots or directory paths', () => {
    const file = path.join(process.cwd(), 'export.json')
    expect(isUsableExportPath(file)).toBe(true)
    expect(isUsableExportPath('relative/export.json')).toBe(false)
    expect(isUsableExportPath(path.parse(file).root)).toBe(false)
    expect(isUsableExportPath(`${file}${path.sep}`)).toBe(false)
    expect(isUsableExportPath(`${file}\u0000`)).toBe(false)
  })
})
