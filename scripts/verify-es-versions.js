/**
 * V0.3.0 Step 7 — multi-version verification harness.
 *
 * Exercises every SearchEngineAdapter capability against a live
 * Elasticsearch cluster and prints a per-capability pass/fail line
 * that maps directly onto the verification matrix in
 * ai-dev-steps/releases/V0.3.0_RELEASES.md §13.
 *
 * Usage (run after `npm run build`):
 *
 *   ES_URL=http://localhost:9200 \
 *     node scripts/verify-es-versions.js
 *
 *   # With basic auth:
 *   ES_URL=https://es.example.com:9200 \
 *   ES_USER=elastic ES_PASS=changeme \
 *   ES_VERSION_LABEL=8.15.0 \
 *     node scripts/verify-es-versions.js
 *
 * Required env:
 *   ES_URL                  e.g. http://localhost:9200
 * Optional env:
 *   ES_USER                 basic-auth user
 *   ES_PASS                 basic-auth password
 *   ES_VERSION_LABEL        string used in the report header
 *                           (e.g. "8.15.0"). Defaults to "unknown".
 *   ES_SKIP_CLEANUP         set to "1" to keep the test index +
 *                           export files for manual inspection.
 *
 * Exit code is 0 when every capability passed, 1 otherwise.
 */

const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

// Resolve the compiled bundle path. The script assumes the user has
// run `npm run build` (or `npm run build:main`) first.
const DIST_MAIN = path.join(__dirname, '..', 'dist', 'main')
if (!fs.existsSync(path.join(DIST_MAIN, 'search', 'adapterRegistry.js'))) {
  console.error(
    `Cannot find compiled bundle at ${DIST_MAIN}/search/adapterRegistry.js.\n` +
      'Run `npm run build` first, then re-run this script.'
  )
  process.exit(2)
}

const ES_URL = process.env.ES_URL
const ES_USER = process.env.ES_USER || ''
const ES_PASS = process.env.ES_PASS || ''
const ES_VERSION_LABEL = process.env.ES_VERSION_LABEL || 'unknown'
const SKIP_CLEANUP = process.env.ES_SKIP_CLEANUP === '1'

if (!ES_URL) {
  console.error('ES_URL env var is required.')
  process.exit(2)
}

const { getSearchEngineAdapter } = require(path.join(
  DIST_MAIN,
  'search',
  'adapterRegistry.js'
))

/* ----------------------------- Harness ----------------------------- */

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  const tag = ok ? 'PASS' : 'FAIL'
  console.log(`[${tag}] ${name}${detail ? `  — ${detail}` : ''}`)
}

async function safe(name, fn) {
  try {
    const detail = await fn()
    record(name, true, detail || '')
  } catch (err) {
    record(name, false, err && err.message ? err.message : String(err))
  }
}

const connection = {
  id: 'verify',
  name: 'verify-script',
  engineType: 'elasticsearch',
  url: ES_URL,
  authType: ES_USER ? 'basic' : 'none',
  username: ES_USER || undefined,
  password: ES_PASS || undefined,
  folderId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

// Unique index name per run so parallel runs do not collide.
const TEST_INDEX = `verify_v030_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`
const TEST_DOC_ID = 'verify_doc_1'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'searchdbpad-verify-'))
const exportPaths = {
  json: path.join(tempDir, `${TEST_INDEX}.json`),
  ndjson: path.join(tempDir, `${TEST_INDEX}.ndjson`),
  csv: path.join(tempDir, `${TEST_INDEX}.csv`)
}
const importPaths = {
  json: path.join(tempDir, `import_${TEST_INDEX}.json`),
  ndjson: path.join(tempDir, `import_${TEST_INDEX}.ndjson`),
  csv: path.join(tempDir, `import_${TEST_INDEX}.csv`)
}

async function main() {
  let adapter
  try {
    adapter = await getSearchEngineAdapter('elasticsearch')
  } catch (err) {
    console.error('Failed to load Elasticsearch adapter:', err.message)
    process.exit(2)
  }

  console.log(`\n=== Verify SearchDBPad V0.3.0 against Elasticsearch ${ES_VERSION_LABEL} ===`)
  console.log(`URL: ${ES_URL}`)
  console.log(`Test index: ${TEST_INDEX}\n`)

  /* ---------------------- Phase 1: Connection ---------------------- */

  await safe('1. testConnection', async () => {
    const r = await adapter.testConnection(connection)
    if (!r.reachable) throw new Error('reachable:false')
    return `cluster=${r.clusterName || '?'} version=${r.version || '?'} health=${r.health || '?'}`
  })

  let serverInfo
  await safe('2. detect', async () => {
    serverInfo = await adapter.detect(connection)
    if (serverInfo.engineType !== 'elasticsearch') {
      throw new Error(`engineType=${serverInfo.engineType}`)
    }
    return `${serverInfo.version} major=${serverInfo.major} minor=${serverInfo.minor} patch=${serverInfo.patch}`
  })

  await safe('3. getClusterInfo', async () => {
    const r = await adapter.getClusterInfo(connection)
    if (!r.clusterName) throw new Error('no clusterName')
    return `clusterName=${r.clusterName} version=${r.version}`
  })

  await safe('4. getClusterHealth', async () => {
    const r = await adapter.getClusterHealth(connection)
    if (!r.status) throw new Error('no status')
    return `status=${r.status} nodes=${r.nodeCount}`
  })

  /* ---------------------- Phase 2: Index lifecycle ---------------------- */

  await safe('5. listIndices', async () => {
    const r = await adapter.listIndices(connection)
    if (!Array.isArray(r)) throw new Error('not array')
    return `count=${r.length}`
  })

  await safe('19. createIndex (empty)', async () => {
    const r = await adapter.createIndex(connection, { index: TEST_INDEX })
    if (!r.acknowledged) throw new Error('acknowledged:false')
    return `index=${r.index}`
  })

  await safe('6. getIndexMapping (empty)', async () => {
    const r = await adapter.getIndexMapping(connection, TEST_INDEX)
    if (!r || typeof r !== 'object') throw new Error('bad shape')
    return `keys=${Object.keys(r).length}`
  })

  await safe('7. getIndexSettings', async () => {
    const r = await adapter.getIndexSettings(connection, TEST_INDEX)
    if (!r || typeof r !== 'object') throw new Error('bad shape')
    return `keys=${Object.keys(r).length}`
  })

  /* ---------------------- Phase 3: Document CRUD ---------------------- */

  await safe('10. createDocument (PUT with id)', async () => {
    const r = await adapter.createDocument(connection, {
      index: TEST_INDEX,
      id: TEST_DOC_ID,
      source: {
        name: 'verify-test',
        value: 42,
        tags: ['a', 'b']
      }
    })
    if (!r.id) throw new Error('no id')
    if (r.result !== 'created') throw new Error(`result=${r.result}`)
    return `id=${r.id} result=${r.result} version=${r.version}`
  })

  await safe('8. searchDocuments (match_all)', async () => {
    const r = await adapter.searchDocuments(connection, {
      index: TEST_INDEX,
      query: { query: { match_all: {} }, size: 10 }
    })
    if (!Array.isArray(r.hits) || r.hits.length !== 1) {
      throw new Error(`hits=${r.hits && r.hits.length}`)
    }
    return `total=${r.total} took=${r.took}ms`
  })

  await safe('9. searchDocuments (DSL term)', async () => {
    const r = await adapter.searchDocuments(connection, {
      index: TEST_INDEX,
      query: { query: { term: { name: 'verify-test' } }, size: 10 }
    })
    if (!Array.isArray(r.hits) || r.hits.length !== 1) {
      throw new Error(`hits=${r.hits && r.hits.length}`)
    }
    return `total=${r.total}`
  })

  // "简单查询" — in our model this is just a structured DSL with a
  // range. We exercise it via the same `searchDocuments` API.
  await safe('9b. searchDocuments (simple range)', async () => {
    const r = await adapter.searchDocuments(connection, {
      index: TEST_INDEX,
      query: { query: { range: { value: { gte: 40 } } }, size: 10 }
    })
    if (!Array.isArray(r.hits) || r.hits.length !== 1) {
      throw new Error(`hits=${r.hits && r.hits.length}`)
    }
    return `total=${r.total}`
  })

  await safe('11. updateDocument (PUT full source)', async () => {
    const r = await adapter.updateDocument(connection, {
      index: TEST_INDEX,
      id: TEST_DOC_ID,
      source: {
        name: 'verify-test',
        value: 100,
        tags: ['a', 'b', 'c']
      }
    })
    if (r.result !== 'updated') throw new Error(`result=${r.result}`)
    return `version=${r.version}`
  })

  await safe('12. deleteDocument', async () => {
    const r = await adapter.deleteDocument(connection, {
      index: TEST_INDEX,
      id: TEST_DOC_ID
    })
    if (r.result !== 'deleted') throw new Error(`result=${r.result}`)
    return `result=${r.result}`
  })

  /* ---------------------- Phase 4: Export ---------------------- */

  // Re-create the doc so export has something to write.
  await safe('seed (re-create doc for export)', async () => {
    await adapter.createDocument(connection, {
      index: TEST_INDEX,
      id: TEST_DOC_ID,
      source: { name: 'verify-test', value: 42, tags: ['a', 'b'] }
    })
    return 'ok'
  })

  await safe('13. exportDocuments (json)', async () => {
    const r = await adapter.exportDocuments(connection, {
      index: TEST_INDEX,
      format: 'json',
      outputPath: exportPaths.json,
      maxRows: 10
    })
    if (!fs.existsSync(exportPaths.json)) throw new Error('file not written')
    if (r.rows !== 1) throw new Error(`rows=${r.rows}`)
    return `bytes=${r.bytes}`
  })

  await safe('14. exportDocuments (ndjson)', async () => {
    const r = await adapter.exportDocuments(connection, {
      index: TEST_INDEX,
      format: 'ndjson',
      outputPath: exportPaths.ndjson,
      maxRows: 10
    })
    if (!fs.existsSync(exportPaths.ndjson)) throw new Error('file not written')
    if (r.rows !== 1) throw new Error(`rows=${r.rows}`)
    return `bytes=${r.bytes}`
  })

  await safe('15. exportDocuments (csv)', async () => {
    const r = await adapter.exportDocuments(connection, {
      index: TEST_INDEX,
      format: 'csv',
      outputPath: exportPaths.csv,
      maxRows: 10
    })
    if (!fs.existsSync(exportPaths.csv)) throw new Error('file not written')
    if (r.rows !== 1) throw new Error(`rows=${r.rows}`)
    return `bytes=${r.bytes}`
  })

  /* ---------------------- Phase 5: Import ---------------------- */

  // Build import fixtures derived from the just-exported files (for
  // json/ndjson) and a hand-written CSV.
  fs.writeFileSync(
    importPaths.json,
    JSON.stringify([{ _id: 'imp_json_1', _source: { kind: 'json', n: 1 } }])
  )
  fs.writeFileSync(
    importPaths.ndjson,
    [
      JSON.stringify({ index: { _index: TEST_INDEX, _id: 'imp_ndjson_1' } }),
      JSON.stringify({ kind: 'ndjson', n: 2 })
    ].join('\n') + '\n'
  )
  fs.writeFileSync(importPaths.csv, 'kind,n\ncsv,3\n')

  // Delete the doc so import appends cleanly without collisions.
  await safe('seed (delete doc before import)', async () => {
    await adapter.deleteDocument(connection, {
      index: TEST_INDEX,
      id: TEST_DOC_ID
    })
    return 'ok'
  })

  await safe('16. importDocuments (json)', async () => {
    const r = await adapter.importDocuments(connection, {
      index: TEST_INDEX,
      rows: [{ id: 'imp_json_1', source: { kind: 'json', n: 1 } }],
      mode: 'append'
    })
    if (r.success !== 1) throw new Error(`success=${r.success}`)
    return `total=${r.total} success=${r.success} failed=${r.failed}`
  })

  await safe('17. importDocuments (ndjson)', async () => {
    const r = await adapter.importDocuments(connection, {
      index: TEST_INDEX,
      rows: [{ id: 'imp_ndjson_1', source: { kind: 'ndjson', n: 2 } }],
      mode: 'append'
    })
    if (r.success !== 1) throw new Error(`success=${r.success}`)
    return `total=${r.total} success=${r.success} failed=${r.failed}`
  })

  await safe('18. importDocuments (csv)', async () => {
    const r = await adapter.importDocuments(connection, {
      index: TEST_INDEX,
      // The CSV adapter input only carries the source body; the
      // renderer-side parser is responsible for splitting columns.
      rows: [{ source: { kind: 'csv', n: '3' } }],
      mode: 'append'
    })
    if (r.success !== 1) throw new Error(`success=${r.success}`)
    return `total=${r.total} success=${r.success} failed=${r.failed}`
  })

  /* ---------------------- Phase 6: ES 6.x mapping type ---------------------- */

  // The "重点测 mapping type" row of the matrix. We verify the
  // adapter's versionCompat layer wraps mappings in `_doc` for 6.x
  // by trying to create an index whose mapping is the typeless
  // shape — if the cluster is 6.x and the wrapping logic is
  // correct, the call succeeds.
  const mappingTestIndex = `${TEST_INDEX}_mapping_type`
  await safe('ES6. createIndex with typeless mapping', async () => {
    const r = await adapter.createIndex(connection, {
      index: mappingTestIndex,
      mappings: {
        properties: {
          kind: { type: 'keyword' },
          n: { type: 'integer' }
        }
      }
    })
    if (!r.acknowledged) throw new Error('acknowledged:false')
    return 'ok'
  })

  /* ---------------------- Phase 7: Index delete ---------------------- */

  await safe('20. deleteIndex (mapping-test)', async () => {
    const r = await adapter.deleteIndex(connection, mappingTestIndex)
    if (!r.acknowledged) throw new Error('acknowledged:false')
    return 'ok'
  })

  await safe('21. deleteIndex (main)', async () => {
    const r = await adapter.deleteIndex(connection, TEST_INDEX)
    if (!r.acknowledged) throw new Error('acknowledged:false')
    return 'ok'
  })

  /* ---------------------- Cleanup ---------------------- */

  if (!SKIP_CLEANUP) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  } else {
    console.log(`\nCleanup skipped. Temp dir: ${tempDir}`)
  }

  /* ---------------------- Report ---------------------- */

  const passed = results.filter((r) => r.ok).length
  const total = results.length
  console.log(
    `\n=== ES ${ES_VERSION_LABEL} summary: ${passed}/${total} capabilities passed ===`
  )
  if (passed !== total) {
    console.log('\nFailed capabilities:')
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.detail}`)
    }
  }
  process.exit(passed === total ? 0 : 1)
}

main().catch((err) => {
  console.error('Harness crashed:', err)
  process.exit(2)
})