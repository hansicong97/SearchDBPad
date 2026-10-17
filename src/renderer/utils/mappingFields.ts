/**
 * Mapping field extraction (V0.3.5 B-1).
 *
 * Recursively walks the `_mapping` payload returned by
 * Elasticsearch and produces a flat list of fields with their full
 * dot-separated path and effective type.
 *
 * The mapping JSON ES returns looks like:
 *   {
 *     "my-index": {
 *       "mappings": {
 *         "properties": {
 *           "title": { "type": "text" },
 *           "user":  { "type": "object", "properties": { "name": ... } },
 *           "tags":  { "type": "text", "fields": { "keyword": { "type": "keyword" } } }
 *         }
 *       }
 *     }
 *   }
 *
 * The result flattens nested `properties` and `fields` (multi-field
 * accessors) into a single list:
 *   - title (text)
 *   - user (object)
 *   - user.name (keyword)
 *   - tags (text)
 *   - tags.keyword (keyword)
 *
 * The shape is intentionally engine-agnostic — only the top-level
 * envelope (`{ "<index>": { mappings: { properties: ... } } }`) is
 * ES-specific, and it matches what every major engine returns.
 */

export interface MappingField {
  /** Dot-separated path, e.g. "user.name" or "tags.keyword". */
  path: string
  /** Effective type, e.g. "text", "keyword", "object", "nested". */
  type: string
  /** True for multi-field sub-accessors (`fields.<name>`). Useful
   *  for the UI to render a different tag. */
  isMultiField: boolean
  /** Solr Schema metadata. Undefined for Elasticsearch mappings. */
  required?: boolean
  multiValued?: boolean
  stored?: boolean
  isUniqueKey?: boolean
}

interface SchemaFieldRecord {
  name?: unknown
  type?: unknown
  required?: unknown
  multiValued?: unknown
  stored?: unknown
}

/**
 * Extract a Solr Schema payload from either the adapter's normalized
 * response (`{ fields, uniqueKey }`) or the legacy raw response
 * (`{ schema: { fields, uniqueKey } }`). Returning `null` means the
 * payload is an Elasticsearch mapping (or is malformed); returning an
 * empty array means a valid Schema with no fields.
 */
export function extractSchemaFields(
  mapping: Record<string, unknown> | null | undefined
): { fields: MappingField[]; uniqueKey?: string } | null {
  if (!mapping || typeof mapping !== 'object') return null

  const root = mapping as Record<string, unknown>
  const schema = root.schema && typeof root.schema === 'object'
    ? root.schema as Record<string, unknown>
    : root
  if (!Array.isArray(schema.fields)) return null

  const uniqueKey = typeof schema.uniqueKey === 'string' ? schema.uniqueKey : undefined
  const fields = (schema.fields as unknown[]).flatMap((raw): MappingField[] => {
    if (!raw || typeof raw !== 'object') return []
    const field = raw as SchemaFieldRecord
    if (typeof field.name !== 'string' || field.name.length === 0) return []
    const type = typeof field.type === 'string' ? field.type : 'unknown'
    return [{
      path: field.name,
      type,
      isMultiField: false,
      required: typeof field.required === 'boolean' ? field.required : undefined,
      multiValued: typeof field.multiValued === 'boolean' ? field.multiValued : undefined,
      stored: typeof field.stored === 'boolean' ? field.stored : undefined,
      isUniqueKey: uniqueKey === field.name
    }]
  })
  return { fields, uniqueKey }
}

/** Recursively walk a `properties` object and return all fields,
 *  including nested ones and multi-field sub-accessors. */
function walkProperties(
  props: Record<string, unknown>,
  prefix: string
): MappingField[] {
  const out: MappingField[] = []
  for (const [name, def] of Object.entries(props)) {
    if (!def || typeof def !== 'object') continue
    const d = def as Record<string, unknown>
    const path = prefix ? `${prefix}.${name}` : name
    const type = typeof d.type === 'string' ? d.type : 'object'
    out.push({ path, type, isMultiField: false })
    // Recurse into nested object / nested properties.
    if (d.properties && typeof d.properties === 'object') {
      out.push(
        ...walkProperties(d.properties as Record<string, unknown>, path)
      )
    }
    // Multi-field sub-accessors (`fields.<name>`). These are not
    // recursive — multi-fields don't carry their own sub-properties.
    if (d.fields && typeof d.fields === 'object') {
      for (const [subName, subDef] of Object.entries(
        d.fields as Record<string, unknown>
      )) {
        if (!subDef || typeof subDef !== 'object') continue
        const sd = subDef as Record<string, unknown>
        const subType = typeof sd.type === 'string' ? sd.type : 'object'
        out.push({
          path: `${path}.${subName}`,
          type: subType,
          isMultiField: true
        })
      }
    }
  }
  return out
}

function findTopLevelProperties(
  mappings: Record<string, unknown>
): Record<string, unknown> | null {
  if (mappings.properties && typeof mappings.properties === 'object') {
    return mappings.properties as Record<string, unknown>
  }
  // Elasticsearch 6.x keeps properties under a document type, e.g.
  // `mappings._doc.properties`.
  for (const value of Object.values(mappings)) {
    if (!value || typeof value !== 'object') continue
    const candidate = (value as Record<string, unknown>).properties
    if (candidate && typeof candidate === 'object') {
      return candidate as Record<string, unknown>
    }
  }
  return null
}

/** Extract a flat list of fields from a `_mapping` payload.
 *  Returns an empty list when the payload is null / malformed —
 *  the caller can decide to render an empty-state placeholder
 *  rather than having to defend against `undefined` everywhere. */
export function extractMappingFields(
  mapping: Record<string, unknown> | null | undefined
): MappingField[] {
  if (!mapping || typeof mapping !== 'object') return []
  const schemaFields = extractSchemaFields(mapping)
  if (schemaFields) return schemaFields.fields
  // The payload is keyed by index name. In practice we only ever
  // request one index at a time, so we just take the first key
  // we find and walk its `mappings.properties`.
  for (const key of Object.keys(mapping)) {
    const idx = mapping[key]
    if (!idx || typeof idx !== 'object') continue
    const mappings = (idx as Record<string, unknown>).mappings
    if (!mappings || typeof mappings !== 'object') continue
    const props = findTopLevelProperties(mappings as Record<string, unknown>)
    if (!props) continue
    return walkProperties(props, '')
  }
  return []
}

/** Case-insensitive substring filter on a list of fields. Returns
 *  the input list unchanged when the query is empty so the call
 *  site doesn't have to special-case the no-filter case. */
export function filterMappingFields(
  fields: MappingField[],
  query: string
): MappingField[] {
  const q = query.trim().toLowerCase()
  if (!q) return fields
  return fields.filter((f) => f.path.toLowerCase().includes(q))
}
