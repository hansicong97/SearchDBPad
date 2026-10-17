import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ImportInput } from '../../src/main/search/adapter.types'

const state = vi.hoisted(() => ({ resolve: vi.fn(), imported: vi.fn(), exported: vi.fn() }))
vi.mock('../../src/main/services/searchEngine.service', () => ({ resolveAdapterByConnectionId: state.resolve }))
vi.mock('../../src/main/services/jobProgress', () => ({ sendImportProgress: state.imported, sendExportProgress: state.exported }))
import { importPreview, runImport } from '../../src/main/services/import.service'
import { runExport } from '../../src/main/services/export.service'
import { getJobSignal, isJobActive, markCancelled } from '../../src/main/services/jobCancel.service'

const dirs: string[] = []
const connection = { id: 'test', engineType: 'elasticsearch' }
const manifest = { protocolFamily: 'elasticsearch-rest', transferFormats: ['json', 'csv', 'ndjson'] }
beforeEach(() => { state.resolve.mockReset(); state.imported.mockReset(); state.exported.mockReset() })
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
async function directory(): Promise<string> {
  const dir = await mkdtemp(path.join(process.cwd(), '.searchdbpad-services-'))
  dirs.push(dir)
  return dir
}

describe('streaming transfer services', () => {
  it('preserves Solr native JSON in both preview and execution without unwrapping fields', async () => {
    const dir = await directory()
    const filePath = path.join(dir, 'solr.json')
    const docs = [
      { id: '1', fields: { title: 'native field' }, sku: 'one' },
      { id: '2', _source: { title: 'also native' }, _id: 'native-id', sku: 'two' }
    ]
    await writeFile(filePath, JSON.stringify(docs))
    const importDocuments = vi.fn(async (_connection, input: ImportInput) => ({ index: input.index, total: input.rows.length, success: input.rows.length, failed: 0, failures: [] }))
    state.resolve.mockResolvedValue({ connection: { ...connection, engineType: 'solr' }, adapter: { manifest: { protocolFamily: 'solr-rest', transferFormats: ['json', 'csv'] }, importDocuments } })
    const preview = await importPreview({ connectionId: 'test', filePath, format: 'json', maxRows: 5 })
    expect(preview.data?.rows.map(row => row.source)).toEqual(docs)
    expect(preview.data?.rows.map(row => row.id)).toEqual([undefined, undefined])
    expect((await runImport({ connectionId: 'test', index: 'books', filePath, format: 'json', mode: 'append' })).success).toBe(true)
    expect(importDocuments.mock.calls[0][1].rows).toEqual(docs.map(source => ({ source })))
  })

  it('restores Elasticsearch CSV IDs without sending the metadata column as a source field', async () => {
    const dir = await directory()
    const filePath = path.join(dir, 'es.csv')
    await writeFile(filePath, '\uFEFF_id,title\r\n42,Book\r\n')
    const importDocuments = vi.fn(async (_connection, input: ImportInput) => ({ index: input.index, total: 1, success: 1, failed: 0, failures: [] }))
    state.resolve.mockResolvedValue({ connection, adapter: { manifest, importDocuments } })
    expect((await runImport({ connectionId: 'test', index: 'books', filePath, format: 'csv', mode: 'append' })).success).toBe(true)
    expect(importDocuments.mock.calls[0][1].rows).toEqual([{ id: '42', source: { title: 'Book' } }])
  })
  it('validates then imports bounded batches, clears once, and aggregates failure offsets', async () => {
    const dir = await directory()
    const filePath = path.join(dir, 'docs.json')
    await writeFile(filePath, JSON.stringify(Array.from({ length: 2005 }, (_, i) => ({ n: i }))))
    const importDocuments = vi.fn(async (_connection, input: ImportInput) => ({
      index: input.index, total: input.rows.length, success: input.rows.length - 1, failed: 1,
      failures: [{ line: 0, error: 'Authorization: Bearer secret from https://user:password@example.test' }]
    }))
    state.resolve.mockResolvedValue({ connection, adapter: { manifest, importDocuments } })
    const result = await runImport({ connectionId: 'test', index: 'docs', filePath, format: 'json', mode: 'replace' })
    expect(result).toMatchObject({ success: true, data: { total: 2005, success: 2002, failed: 3, failures: [{ line: 0 }, { line: 1000 }, { line: 2000 }] } })
    expect(JSON.stringify(result)).not.toMatch(/Authorization|Bearer secret|password|example\.test/)
    expect(result.data?.failures.map((failure) => failure.error)).toEqual([
      '文档导入失败，请检查文档格式、字段类型和写入权限',
      '文档导入失败，请检查文档格式、字段类型和写入权限',
      '文档导入失败，请检查文档格式、字段类型和写入权限'
    ])
    expect(importDocuments.mock.calls.map(([, input]) => input.rows.length)).toEqual([1000, 1000, 5])
    expect(importDocuments.mock.calls.map(([, input]) => input.mode)).toEqual(['replace', 'append', 'append'])
    const progress = state.imported.mock.calls.map(([event]) => event)
    expect(progress.filter((event) => ['completed', 'failed'].includes(event.stage))).toHaveLength(1)
    expect(isJobActive(progress[0].jobId)).toBe(false)
    expect(getJobSignal(progress[0].jobId)).toBeUndefined()
  })

  it('rejects malformed replacement input before any adapter write', async () => {
    const dir = await directory()
    const filePath = path.join(dir, 'docs.json')
    await writeFile(filePath, '[{"valid":true},]')
    const importDocuments = vi.fn()
    state.resolve.mockResolvedValue({ connection, adapter: { manifest, importDocuments } })
    expect((await runImport({ connectionId: 'test', index: 'docs', filePath, format: 'json', mode: 'replace' })).success).toBe(false)
    expect(importDocuments).not.toHaveBeenCalled()
  })

  it('keeps replacement pending across an all-invalid first batch', async () => {
    const dir = await directory()
    const filePath = path.join(dir, 'docs.json')
    await writeFile(filePath, JSON.stringify(Array.from({ length: 2001 }, (_, i) => ({ n: i }))))
    const importDocuments = vi.fn(async (_connection, input: ImportInput) => {
      const callIndex = importDocuments.mock.calls.length - 1
      const success = callIndex === 1 ? 1 : 0
      return {
        index: input.index,
        total: input.rows.length,
        success,
        failed: input.rows.length - success,
        failures: success ? [{ line: 1, error: 'invalid' }] : [{ line: 0, error: 'invalid' }],
        replaceApplied: success > 0
      }
    })
    state.resolve.mockResolvedValue({ connection, adapter: { manifest, importDocuments } })

    const result = await runImport({ connectionId: 'test', index: 'docs', filePath, format: 'json', mode: 'replace' })

    expect(result).toMatchObject({ success: true, data: { total: 2001, success: 1, failed: 2000, failures: [{ line: 0 }, { line: 1001 }, { line: 2000 }] } })
    expect(importDocuments.mock.calls.map(([, input]) => input.rows.length)).toEqual([1000, 1000, 1])
    expect(importDocuments.mock.calls.map(([, input]) => input.mode)).toEqual(['replace', 'replace', 'append'])
  })

  it('writes union CSV headers across batches with correct quoting and no temporary files', async () => {
    const dir = await directory()
    const outputPath = path.join(dir, 'docs.csv')
    await writeFile(outputPath, 'previous export')
    state.resolve.mockResolvedValue({ connection, adapter: { manifest, async *exportBatches() {
      yield [{ id: '1', fields: { a: 'hello,world' } }]
      yield [{ id: '2', fields: { b: 'line\nnext' } }]
    } } })
    const result = await runExport({ connectionId: 'test', index: 'docs', outputPath, format: 'csv', maxRows: 10 })
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, data: { rows: 2 } })
    expect(await readFile(outputPath, 'utf8')).toBe('\uFEFF_id,a,b\r\n1,"hello,world",\r\n2,,"line\nnext"\r\n')
    expect(await readdir(dir)).toEqual(['docs.csv'])
    const progress = state.exported.mock.calls.map(([event]) => event)
    expect(progress.filter((event) => ['completed', 'failed'].includes(event.stage))).toHaveLength(1)
    expect(isJobActive(progress[0].jobId)).toBe(false)
  })

  it('cancellation preserves the destination, closes the iterator and removes partial files', async () => {
    const dir = await directory()
    const outputPath = path.join(dir, 'docs.json')
    await writeFile(outputPath, 'existing')
    let closed = false
    state.resolve.mockResolvedValue({ connection, adapter: { manifest, async *exportBatches() {
      try {
        yield [{ id: '1', fields: { a: 1 } }]
        const jobId = state.exported.mock.calls[0][0].jobId
        markCancelled(jobId)
        yield [{ id: '2', fields: { a: 2 } }]
      } finally { closed = true }
    } } })
    const result = await runExport({ connectionId: 'test', index: 'docs', outputPath, format: 'json', maxRows: 10 })
    expect(result).toMatchObject({ success: false, error: { message: '用户已停止' } })
    expect(closed).toBe(true)
    expect(await readFile(outputPath, 'utf8')).toBe('existing')
    expect(await readdir(dir)).toEqual(['docs.json'])
    expect(state.exported.mock.calls.filter(([event]) => ['completed', 'cancelled', 'failed'].includes(event.stage))).toHaveLength(1)
  })

  it('validates declared transfer formats before querying', async () => {
    const dir = await directory()
    const exportBatches = vi.fn()
    state.resolve.mockResolvedValue({ connection, adapter: { manifest: { protocolFamily: 'solr', transferFormats: ['json', 'csv'] }, exportBatches } })
    const result = await runExport({ connectionId: 'test', index: 'docs', outputPath: path.join(dir, 'docs.ndjson'), format: 'ndjson', maxRows: 10 })
    expect(result.success).toBe(false)
    expect(exportBatches).not.toHaveBeenCalled()
    expect(await readdir(dir)).toEqual([])
  })

  it('does not synthesize an Elasticsearch id column for Solr CSV', async () => {
    const dir = await directory()
    const outputPath = path.join(dir, 'solr.csv')
    state.resolve.mockResolvedValue({ connection, adapter: { manifest: { protocolFamily: 'solr-rest', transferFormats: ['csv'] }, async *exportBatches() {
      yield [{ id: 'ignored', fields: { id: 'doc-1', title: 'hello' } }]
    } } })
    const result = await runExport({ connectionId: 'test', index: 'docs', outputPath, format: 'csv', maxRows: 10 })
    expect(result).toMatchObject({ success: true, data: { rows: 1 } })
    expect(await readFile(outputPath, 'utf8')).toBe('\uFEFFid,title\r\ndoc-1,hello\r\n')
  })
})
