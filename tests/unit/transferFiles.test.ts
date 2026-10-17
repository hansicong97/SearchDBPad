import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readImportRows } from '../../src/main/services/transferFiles'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
async function fixture(name: string, text: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'searchdbpad-transfer-'))
  dirs.push(dir)
  const file = path.join(dir, name)
  await writeFile(file, text)
  return file
}

describe('readImportRows', () => {
  it('streams a JSON array with nested objects and ids', async () => {
    const file = await fixture('docs.json', '[{"_id":"1","_source":{"v":[1,{"x":true}]}},{"v":2}]')
    const rows = []
    for await (const row of readImportRows(file, 'json')) rows.push(row)
    expect(rows.map(({ id, source }) => ({ id, source }))).toEqual([
      { id: '1', source: { v: [1, { x: true }] } },
      { id: undefined, source: { v: 2 } }
    ])
  })

  it('parses multiline quoted CSV values and checks column counts', async () => {
    const file = await fixture('docs.csv', 'name,note\r\nAlice,"hello,\r\nworld"\r\n')
    const rows = []
    for await (const row of readImportRows(file, 'csv')) rows.push(row)
    expect(rows[0].source).toEqual({ name: 'Alice', note: 'hello,\r\nworld' })
    const invalid = await fixture('bad.csv', 'a,b\n1\n')
    await expect(async () => { for await (const _ of readImportRows(invalid, 'csv')) void _ }).rejects.toThrow('列数')
  })

  it('keeps Bulk IDs, rejects unsupported actions, and cleans up on abort', async () => {
    const file = await fixture('bulk.ndjson', '{"index":{"_id":"42"}}\n{"answer":42}\n')
    const rows = []
    for await (const row of readImportRows(file, 'ndjson')) rows.push(row)
    expect(rows[0]).toMatchObject({ id: '42', source: { answer: 42 } })
    const bad = await fixture('bad.ndjson', '{"delete":{"_id":"42"}}\n{}\n')
    await expect(async () => { for await (const _ of readImportRows(bad, 'ndjson')) void _ }).rejects.toThrow('仅支持')
    const controller = new AbortController()
    controller.abort()
    await expect(async () => { for await (const _ of readImportRows(file, 'ndjson', controller.signal)) void _ }).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('preserves JSON and quoted CSV values spanning read chunks', async () => {
    const text = 'x'.repeat(65530) + '\\"escaped\nnext'
    const json = await fixture('large.json', JSON.stringify([{ text }, { text: 'last' }]))
    const jsonRows = []
    for await (const row of readImportRows(json, 'json')) jsonRows.push(row)
    expect(jsonRows.map((row) => row.source.text)).toEqual([text, 'last'])
    const csvText = 'x'.repeat(65528) + '"quoted"\r\nnext'
    const csv = await fixture('large.csv', 'text\r\n"' + csvText.replace(/"/g, '""') + '"\r\nlast\r\n')
    const csvRows = []
    for await (const row of readImportRows(csv, 'csv')) csvRows.push(row)
    expect(csvRows.map((row) => row.source.text)).toEqual([csvText, 'last'])
  })
})
