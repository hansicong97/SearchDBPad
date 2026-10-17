import type { SearchConnection, SearchSchemaResult } from '../../../shared/searchEngine'
import { getIndexMapping } from './indexApi'

type JsonObject = Record<string, unknown>
const isObject = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value)

/** Preserve nested ancestry and multi-fields without imposing ES metadata on
 * other engines. OpenSearch uses this same mapping protocol. */
export async function getSchema(connection: SearchConnection, resourceName: string): Promise<SearchSchemaResult> {
  const raw = await getIndexMapping(connection, resourceName)
  const fields: SearchSchemaResult['fields'] = []
  const walk = (properties: JsonObject, prefix: string, nestedPaths: string[], metadata: JsonObject): void => {
    for (const [name, field] of Object.entries(properties)) {
      if (!isObject(field)) continue
      const path = prefix ? `${prefix}.${name}` : name
      const ancestry = field.type === 'nested' ? [...nestedPaths, path] : nestedPaths
      const details = { ...metadata, ...(ancestry.length ? { nestedPaths: ancestry } : {}) }
      fields.push({ name: path, type: typeof field.type === 'string' ? field.type : isObject(field.properties) ? 'object' : undefined,
        ...(Object.keys(details).length ? { metadata: details } : {}) })
      if (isObject(field.properties)) walk(field.properties, path, ancestry, metadata)
      if (isObject(field.fields)) walk(field.fields, path, ancestry, { ...metadata, multiFieldOf: path })
    }
  }
  const mappings = (value: JsonObject, metadata: JsonObject): void => {
    if (isObject(value.properties)) walk(value.properties, '', [], metadata)
    else {
      // ES 6 can return more than one mapping type for a resource.
      for (const [mappingType, typed] of Object.entries(value)) {
        if (isObject(typed) && isObject(typed.properties)) walk(typed.properties, '', [], { ...metadata, mappingType })
      }
    }
  }
  if (isObject(raw)) {
    if (isObject(raw.mappings)) mappings(raw.mappings, {})
    else if (isObject(raw.properties)) mappings(raw, {})
    else {
      const resources = Object.entries(raw).filter(([, value]) => isObject(value) && isObject(value.mappings))
      if (resources.length) {
        for (const [name, value] of resources) mappings((value as JsonObject).mappings as JsonObject, resources.length > 1 ? { resourceName: name } : {})
      } else mappings(raw, {})
    }
  }
  return { connectionId: connection.id, resourceName, raw, fields }
}
