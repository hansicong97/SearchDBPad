/**
 * Search Engine Adapter registry.
 *
 * V0.3.0 §6: this is the single entry point the service layer uses to
 *  obtain an adapter. It dispatches by `SearchConnection.engineType`
 *  and lazy-loads each adapter via dynamic `import()` so the bundle
 *  stays clean for the "no Solr" build of the app.
 *
 * Why dynamic import:
 *  - Each adapter is its own module under `src/main/adapters/<engine>`.
 *  - A future `dist:mac` or `dist:all` build can drop unused adapter
 *    folders via electron-builder `files` globbing without touching
 *    this file's source.
 *  - Static `import { elasticsearchAdapter } from '../adapters/...'`
 *    would defeat that and would also force every adapter to be in
 *    the typecheck graph even before it ships.
 */

import type { SearchEngineType } from '../../shared/searchEngine'
import type { SearchEngineAdapter } from './adapter.types'

/** Return the adapter for the given engine type.
 *
 *  Throws if the engine type is unrecognised or its adapter is not
 *  shipped in this build. Step 2 ships only `elasticsearch`; other
 *  literals will be rejected at the type system AND at runtime. */
export async function getSearchEngineAdapter(
  type: SearchEngineType
): Promise<SearchEngineAdapter> {
  switch (type) {
    case 'elasticsearch': {
      // Path is held in a variable so TypeScript does not try to
      // resolve the module at typecheck time — the
      // `src/main/adapters/elasticsearch/index.ts` file lands in
      // V0.3.0 Step 3. Runtime resolution still happens against the
      // real filesystem path. The try/catch turns a "Cannot find
      // module" into the spec-required clear error message.
      const adapterPath = '../adapters/elasticsearch'
      try {
        const mod = (await import(adapterPath)) as {
          elasticsearchAdapter: SearchEngineAdapter
        }
        return mod.elasticsearchAdapter
      } catch (err) {
        throw new Error(
          `Elasticsearch 适配器尚未实现 (V0.3.0 Step 3): ${(err as Error).message}`
        )
      }
    }
    default:
      throw new Error(`当前版本未启用搜索引擎适配器: ${type}`)
  }
}