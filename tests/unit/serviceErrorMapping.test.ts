import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchEngineError } from '../../src/main/search/errors'

const mocks = vi.hoisted(() => ({
  resolveAdapterByConnectionId: vi.fn(),
  loadDslFavorites: vi.fn(),
  saveDslFavorites: vi.fn()
}))

vi.mock('../../src/main/services/searchEngine.service', () => ({
  resolveAdapterByConnectionId: mocks.resolveAdapterByConnectionId
}))
vi.mock('../../src/main/store/dslFavoriteStore', () => ({
  loadDslFavorites: mocks.loadDslFavorites,
  saveDslFavorites: mocks.saveDslFavorites
}))

import { addAlias, deleteAlias, listAliases } from '../../src/main/services/alias.service'
import { createIndexTemplate, deleteIndexTemplate, getIndexTemplate, listIndexTemplates } from '../../src/main/services/template.service'
import { createDslFavorite, listDslFavorites } from '../../src/main/services/dslFavorite.service'

const secret = 'Authorization: Bearer secret https://elastic:password@example.test/private'
const connection = { id: 'c1', engineType: 'elasticsearch' }
function serverError() {
  return new SearchEngineError({
    engineType: 'elasticsearch', status: 503, code: 'http_error',
    message: secret, details: { headers: { Authorization: secret } }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadDslFavorites.mockReturnValue([])
})

describe('safe service error boundaries', () => {
  it.each([
    ['alias:list', 'listAliases', () => listAliases('c1')],
    ['alias:create', 'addAlias', () => addAlias({ connectionId: 'c1', index: 'docs', alias: 'current' })],
    ['alias:delete', 'deleteAlias', () => deleteAlias({ connectionId: 'c1', index: 'docs', alias: 'current' })],
    ['template:list', 'listIndexTemplates', () => listIndexTemplates('c1')],
    ['template:get', 'getIndexTemplate', () => getIndexTemplate({ connectionId: 'c1', name: 'docs' })],
    ['template:create', 'createIndexTemplate', () => createIndexTemplate({ connectionId: 'c1', name: 'docs', template: {} })],
    ['template:delete', 'deleteIndexTemplate', () => deleteIndexTemplate({ connectionId: 'c1', name: 'docs' })]
  ] as const)('maps %s to a safe envelope', async (operation, method, invoke) => {
    mocks.resolveAdapterByConnectionId.mockResolvedValueOnce({
      connection,
      adapter: { type: 'elasticsearch', [method]: vi.fn().mockRejectedValue(serverError()) }
    })
    const result = await invoke()
    expect(result).toMatchObject({ success: false, error: { code: 'http_error', operation } })
    expect(JSON.stringify(result)).not.toMatch(/Authorization|secret|password|example\.test|headers/)
  })

  it('keeps malformed favorite JSON actionable without echoing parser text', () => {
    const result = createDslFavorite({ name: 'bad', indexName: '', dsl: '{"secret":' })
    expect(result).toEqual({ success: false, error: {
      code: 'invalid_request', operation: 'dsl-favorite:create', message: 'DSL JSON 格式无效，请检查输入'
    } })
    expect(mocks.saveDslFavorites).not.toHaveBeenCalled()
  })

  it('does not leak favorite persistence exceptions', () => {
    mocks.loadDslFavorites.mockImplementationOnce(() => { throw new Error(secret) })
    const result = listDslFavorites()
    expect(result).toMatchObject({ success: false, error: { code: 'operation_failed', operation: 'dsl-favorite:list' } })
    expect(JSON.stringify(result)).not.toMatch(/Authorization|secret|password|example\.test/)
  })
})
