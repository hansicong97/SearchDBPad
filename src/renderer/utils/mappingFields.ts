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

/** Extract a flat list of fields from a `_mapping` payload.
 *  Returns an empty list when the payload is null / malformed —
 *  the caller can decide to render an empty-state placeholder
 *  rather than having to defend against `undefined` everywhere. */
export function extractMappingFields(
  mapping: Record<string, unknown> | null | undefined
): MappingField[] {
  if (!mapping || typeof mapping !== 'object') return []
  // The payload is keyed by index name. In practice we only ever
  // request one index at a time, so we just take the first key
  // we find and walk its `mappings.properties`.
  for (const key of Object.keys(mapping)) {
    const idx = mapping[key]
    if (!idx || typeof idx !== 'object') continue
    const mappings = (idx as Record<string, unknown>).mappings
    if (!mappings || typeof mappings !== 'object') continue
    const props = (mappings as Record<string, unknown>).properties
    if (!props || typeof props !== 'object') continue
    return walkProperties(props as Record<string, unknown>, '')
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
