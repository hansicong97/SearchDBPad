/** Built-in adapter registration and capability validation.
 *  External code loading, installation and permissions are deliberately outside
 *  this registry. A manifest describes product support, not a download URL. */
import { elasticsearchManifest } from '../adapters/elasticsearch'
import { opensearchManifest } from '../adapters/opensearch'
import { solrManifest } from '../adapters/solr'
import { emptySearchEngineCapabilities } from '../../shared/searchEngine'
import type { SearchEngineCapabilities, SearchEngineManifest, SearchEngineType } from '../../shared/searchEngine'
import type { AdapterOperations, SearchEngineAdapter } from './adapter.types'
import { SearchEngineError } from './errors'

type AdapterFactory = () => SearchEngineAdapter | Promise<SearchEngineAdapter>
interface Registration {
  manifest: SearchEngineManifest
  factory: AdapterFactory
  instance?: Promise<SearchEngineAdapter>
}

const registrations = new Map<SearchEngineType, Registration>()
// `versionFeatures` is detected at runtime and carries feature flags rather
// than adapter operations. Keep it out of the operation map so adding a new
// version-derived flag cannot make every adapter pretend to implement an
// operation for it.
type OperationCapability = Exclude<keyof SearchEngineCapabilities, 'versionFeatures'>
const capabilityOperations: Record<OperationCapability, Array<keyof AdapterOperations>> = {
  resourceCatalog: ['listResources'],
  documentQuery: ['queryDocuments'],
  documentWrite: ['createDocument', 'updateDocument', 'deleteDocument'],
  schema: ['getSchema'],
  indexManagement: ['getClusterInfo', 'getClusterHealth', 'listIndices', 'getIndexMapping', 'getIndexSettings', 'searchDocuments'],
  bulkTransfer: ['importDocuments', 'exportDocuments', 'exportBatches'],
  tasks: ['executeTask', 'getTask', 'cancelTask'],
  indices: ['listIndices', 'createIndex', 'deleteIndex'],
  mappings: ['getIndexMapping', 'updateIndexMapping'],
  settings: ['getIndexSettings', 'updateIndexSettings'],
  aliases: ['listAliases', 'addAlias', 'deleteAlias'],
  indexTemplates: ['listIndexTemplates', 'getIndexTemplate', 'createIndexTemplate', 'deleteIndexTemplate'],
  dslQuery: ['queryDocuments'],
  simpleQuery: ['queryDocuments'],
  importExport: ['importDocuments', 'exportDocuments', 'exportBatches'],
  openCloseIndex: ['openIndex', 'closeIndex'],
  shardManagement: ['listIndexShards', 'relocateShard', 'cancelShardAllocation'],
  maintenance: ['refreshIndex', 'flushIndex', 'forceMergeIndex', 'clearIndexCache'],
  deepPagination: ['queryDocuments'],
  reindex: ['executeTask', 'getTask', 'cancelTask'],
  queryMutation: ['executeTask', 'getTask', 'cancelTask']
}

function copyManifest(manifest: SearchEngineManifest): SearchEngineManifest {
  return {
    ...manifest, supportedVersions: [...manifest.supportedVersions],
    authSchemes: [...manifest.authSchemes], queryLanguages: [...manifest.queryLanguages],
    transferFormats: [...manifest.transferFormats], capabilities: {
      ...manifest.capabilities,
      ...(manifest.capabilities.versionFeatures ? { versionFeatures: { ...manifest.capabilities.versionFeatures } } : {})
    }
  }
}

function validateManifest(manifest: SearchEngineManifest): void {
  if (!manifest || manifest.manifestVersion !== 1) throw new TypeError('Unsupported adapter manifest version')
  if (!['elasticsearch', 'opensearch', 'solr'].includes(manifest.type)) throw new TypeError('Unknown search engine type')
  for (const value of [manifest.displayName, manifest.protocolFamily, manifest.adapterVersion]) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError('Adapter identity must not be empty')
  }
  if (!['index', 'collection', 'mixed'].includes(manifest.resourceModel)) throw new TypeError('Invalid adapter resource model')
  if (!Array.isArray(manifest.supportedVersions) || manifest.supportedVersions.length === 0 ||
    manifest.supportedVersions.some(version => typeof version !== 'string' || version.trim().length === 0)) {
    throw new TypeError('Adapter supportedVersions must contain explicit version ranges')
  }
  if (!Array.isArray(manifest.authSchemes) || manifest.authSchemes.length === 0 ||
    manifest.authSchemes.some(scheme => !['none', 'basic'].includes(scheme))) throw new TypeError('Invalid adapter authentication schemes')
  if (!Array.isArray(manifest.queryLanguages) || manifest.queryLanguages.some(language => !['elasticsearch-dsl', 'solr'].includes(language))) {
    throw new TypeError('Invalid adapter query languages')
  }
  if (!Array.isArray(manifest.transferFormats) || manifest.transferFormats.some(format => !['json', 'csv', 'ndjson'].includes(format))) {
    throw new TypeError('Invalid adapter transfer formats')
  }
  for (const capability of Object.keys(emptySearchEngineCapabilities()) as Array<keyof SearchEngineCapabilities>) {
    if (typeof manifest.capabilities?.[capability] !== 'boolean') throw new TypeError('Every adapter capability must be explicit')
  }
}

function validateAdapter(adapter: SearchEngineAdapter, manifest: SearchEngineManifest): void {
  if (!adapter || adapter.type !== manifest.type || adapter.displayName !== manifest.displayName) {
    throw new TypeError('Adapter identity does not match its registered manifest')
  }
  validateManifest(adapter.manifest)
  for (const key of ['type', 'displayName', 'protocolFamily', 'adapterVersion', 'resourceModel'] as const) {
    if (adapter.manifest[key] !== manifest[key]) throw new TypeError('Adapter manifest does not match its registered identity')
  }
  for (const key of ['supportedVersions', 'authSchemes', 'queryLanguages', 'transferFormats'] as const) {
    if (JSON.stringify(adapter.manifest[key]) !== JSON.stringify(manifest[key])) {
      throw new TypeError('Adapter manifest does not match its registered contract')
    }
  }
  for (const method of ['detect', 'testConnection', 'getCapabilities'] as const) {
    if (typeof adapter[method] !== 'function') throw new TypeError('Adapter is missing a base operation: ' + method)
  }
  for (const capability of Object.keys(capabilityOperations) as OperationCapability[]) {
    if (adapter.manifest.capabilities[capability] !== manifest.capabilities[capability]) {
      throw new TypeError('Adapter capabilities do not match its registered manifest')
    }
    if (!manifest.capabilities[capability]) continue
    for (const operation of capabilityOperations[capability]) {
      if (typeof adapter[operation] !== 'function') {
        throw new TypeError('Adapter capability ' + capability + ' is missing operation: ' + operation)
      }
    }
  }
}

/** Register an in-process implementation; duplicate identities are rejected. */
export function registerBuiltinAdapter(manifest: SearchEngineManifest, factory: AdapterFactory): void {
  validateManifest(manifest)
  if (typeof factory !== 'function') throw new TypeError('Adapter factory must be a function')
  if (registrations.has(manifest.type)) throw new TypeError('Adapter already registered: ' + manifest.type)
  registrations.set(manifest.type, { manifest: copyManifest(manifest), factory })
}

/** Only public metadata crosses IPC. Callers cannot mutate registered metadata. */
export function listEnabledAdapters(): SearchEngineManifest[] {
  return [...registrations.values()].map(entry => copyManifest(entry.manifest))
}

/** Resolve once per engine, coalescing concurrent callers. Failed initialization
 *  is evicted so a transient module failure does not poison the app session. */
export function resolveAdapter(type: SearchEngineType): Promise<SearchEngineAdapter> {
  const entry = registrations.get(type)
  if (!entry) return Promise.reject(new SearchEngineError({
    engineType: type, code: 'unsupported_capability', message: '当前版本未启用此搜索引擎适配器。'
  }))
  if (!entry.instance) {
    entry.instance = Promise.resolve().then(entry.factory).then(adapter => {
      validateAdapter(adapter, entry.manifest)
      return adapter
    }).catch(error => {
      entry.instance = undefined
      throw error
    })
  }
  return entry.instance
}

/** Internal alias retained while services adopt the generic registry name. */
export const getSearchEngineAdapter = resolveAdapter

registerBuiltinAdapter(elasticsearchManifest, async () => (await import('../adapters/elasticsearch')).elasticsearchAdapter)
registerBuiltinAdapter(opensearchManifest, async () => (await import('../adapters/opensearch')).opensearchAdapter)
registerBuiltinAdapter(solrManifest, async () => (await import('../adapters/solr')).solrAdapter)
