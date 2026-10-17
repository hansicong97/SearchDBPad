import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), progress: vi.fn() }))
vi.mock('../../src/main/services/searchEngine.service', () => ({ resolveAdapterByConnectionId: mocks.resolve }))
vi.mock('../../src/main/services/jobProgress', () => ({ sendImportProgress: mocks.progress }))

import { createDocument, updateDocument, deleteDocument, searchDocuments } from '../../src/main/services/document.service'
import { queryResource, getResourceSchema, executeTask, inspectTask, getCapabilities, listResources } from '../../src/main/services/resource.service'
import { importPreview, runImport } from '../../src/main/services/import.service'

const document = { connectionId: 'c1', index: 'books', id: '1', source: { title: 'Book' } }
const query = { connectionId: 'c1', resourceName: 'books', queryLanguage: 'solr', query: { q: '*:*' } }

beforeEach(() => vi.clearAllMocks())

describe('multi-engine IPC input validation before side effects', () => {
  it.each([
    ['create', () => createDocument(null as any)],
    ['update', () => updateDocument({ ...document, id: 7 } as any)],
    ['delete', () => deleteDocument({ ...document, id: '' })],
    ['query', () => searchDocuments({ ...document, query: [] } as any)],
    ['source array', () => createDocument({ ...document, source: [] } as any)],
    ['commit policy', () => createDocument({ ...document, commitPolicy: 'unexpected' } as any)],
    ['resource array', () => getResourceSchema([] as any)],
    ['resource dot', () => getResourceSchema({ connectionId: 'c1', resourceName: '..' })],
    ['resource control', () => getResourceSchema({ connectionId: 'c1', resourceName: 'books\u007f' })],
    ['query sequence', () => queryResource({ ...query, requestSeq: -1 } as any)],
    ['query language', () => queryResource({ ...query, queryLanguage: {} } as any)],
    ['task operation', () => executeTask({ connectionId: 'c1', resourceName: 'books', operation: 'erase', body: {} } as any)],
    ['task body', () => executeTask({ connectionId: 'c1', resourceName: 'books', operation: 'deleteByQuery', body: [] } as any)],
    ['task ref', () => inspectTask({ connectionId: 'c1', taskId: '' })],
    ['capabilities', () => getCapabilities({} as any)],
    ['resources', () => listResources('')],
    ['preview format', () => importPreview({ filePath: 'unused.json', format: 'arbitrary', maxRows: 5 } as any)],
    ['preview size', () => importPreview({ filePath: 'unused.json', format: 'json', maxRows: NaN })],
    ['import mode', () => runImport({ ...document, filePath: 'unused.json', format: 'json', mode: 'erase' } as any)],
    ['import path', () => runImport({ ...document, filePath: 12, format: 'json', mode: 'replace' } as any)]
  ])('returns a safe failure for %s without resolving an adapter', async (_label, invoke) => {
    expect(await invoke()).toMatchObject({ success: false, error: { code: 'invalid_request', operation: expect.any(String) } })
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.progress).not.toHaveBeenCalled()
  })
})
