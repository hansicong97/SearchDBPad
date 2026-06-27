/**
 * Mapping → antd Tree data converter (V0.3.8 B-5).
 *
 * Walks the `_mapping` payload returned by Elasticsearch and produces
 * a nested structure suitable for `antd.Tree`. The flat list version
 * of this lives in `mappingFields.ts` (V0.3.5 B-1); the tree version
 * preserves the parent/child relationships so the user can collapse
 * and expand branches like an IDE outline.
 *
 * Mapping shape:
 *   {
 *     "<indexName>": {
 *       "mappings": {
 *         "properties": {
 *           "title":  { "type": "text" },
 *           "tags":   { "type": "text", "fields": { "keyword": { ... } } },
 *           "user":   { "type": "object", "properties": { ... } }
 *         }
 *       }
 *     }
 *   }
 *
 * Output node shape:
 *   - key      — stable, derived from the dot-path of the field, so
 *                the search-by-hit feature can find the right node
 *                to expand
 *   - title    — JSX with the field name + a type tag (color-coded
 *                per the ES field type taxonomy)
 *   - children — populated for `object` / `nested` properties and
 *                for multi-field `fields.<name>` accessors
 *   - isLeaf   — true when the field has no `properties` and no
 *                `fields` (i.e. a leaf type like `text` / `keyword`)
 */

import type { Key } from 'react'
import type { TreeDataNode } from 'antd'
import { Tag } from 'antd'

/** Field-type → tag color. Matches the visual conventions used by
 *  Kibana / Dev Tools: blue for the common "term-ish" types, purple
 *  for object-ish containers, gold for the special-purpose ones. */
const TYPE_COLOR: Record<string, string> = {
  text: 'blue',
  keyword: 'geekblue',
  integer: 'green',
  long: 'green',
  short: 'green',
  byte: 'green',
  double: 'green',
  float: 'green',
  half_float: 'green',
  scaled_float: 'green',
  boolean: 'cyan',
  date: 'magenta',
  date_nanos: 'magenta',
  ip: 'volcano',
  binary: 'volcano',
  geo_point: 'gold',
  geo_shape: 'gold',
  object: 'purple',
  nested: 'purple',
  join: 'gold',
  alias: 'default'
}

function colorForType(t: string): string {
  return TYPE_COLOR[t] ?? 'default'
}

interface FieldDef {
  type?: unknown
  properties?: Record<string, unknown>
  fields?: Record<string, unknown>
}

/** Recursively walk `properties` and `fields` and produce tree nodes.
 *  `parentKey` is the dot-path of the parent — used to give every
 *  node a stable, unique React key. */
function walkProps(
  props: Record<string, unknown>,
  parentKey: string
): TreeDataNode[] {
  return Object.entries(props).map(([name, defRaw]) => {
    const key: Key = parentKey ? `${parentKey}.${name}` : name
    const def = (defRaw ?? {}) as FieldDef
    const type = typeof def.type === 'string' ? def.type : 'object'
    const children: TreeDataNode[] = []

    // Recurse into nested object / nested properties first.
    if (def.properties && typeof def.properties === 'object') {
      children.push(
        ...walkProps(def.properties as Record<string, unknown>, String(key))
      )
    }
    // Multi-field sub-accessors (`fields.<name>`). These are leaves
    // from the user's perspective — they don't carry their own
    // sub-properties — so we render them as plain children with
    // a `multi-field` marker.
    if (def.fields && typeof def.fields === 'object') {
      for (const [subName, subDefRaw] of Object.entries(
        def.fields as Record<string, unknown>
      )) {
        const subDef = (subDefRaw ?? {}) as FieldDef
        const subType =
          typeof subDef.type === 'string' ? subDef.type : 'object'
        children.push({
          key: `${key}.${subName}`,
          title: renderTitle(subName, subType, true),
          isLeaf: true
        })
      }
    }

    return {
      key,
      title: renderTitle(name, type, false),
      children: children.length > 0 ? children : undefined,
      isLeaf: children.length === 0
    }
  })
}

/** Render a tree node title as field name + type tag. Kept tiny
 *  so the antd Tree doesn't need to memoize wrappers — the title
 *  is a stable React element for a given (name, type, multiField)
 *  triple and antd only re-renders when its key changes. */
function renderTitle(name: string, type: string, multiField: boolean) {
  return (
    <span>
      <span style={{ marginRight: 6 }}>{name}</span>
      <Tag color={colorForType(type)} style={{ margin: 0 }}>
        {type}
      </Tag>
      {multiField ? (
        <Tag color="default" style={{ margin: 0, marginLeft: 4 }}>
          multi-field
        </Tag>
      ) : null}
    </span>
  )
}

/** Convert a `_mapping` payload to an `antd.Tree` `treeData` array.
 *  Returns `[]` when the payload is missing or malformed so callers
 *  can render an empty-state placeholder directly.
 *
 *  This walks the same payload shape as `extractMappingFields`; we
 *  intentionally do not share a single helper because the tree
 *  cares about structure and the flat list does not. */
export function mappingToTreeData(
  mapping: Record<string, unknown> | null | undefined
): TreeDataNode[] {
  if (!mapping || typeof mapping !== 'object') return []
  for (const key of Object.keys(mapping)) {
    const idx = mapping[key]
    if (!idx || typeof idx !== 'object') continue
    const mappings = (idx as Record<string, unknown>).mappings
    if (!mappings || typeof mappings !== 'object') continue
    const props = (mappings as Record<string, unknown>).properties
    if (!props || typeof props !== 'object') continue
    return walkProps(props as Record<string, unknown>, '')
  }
  return []
}

/** Walk the tree and collect every node key whose title text
 *  (the field name part) matches the case-insensitive substring.
 *  Used by `MappingTree` to decide which paths to auto-expand when
 *  the user types in the search box. */
export function findMatchingKeys(
  nodes: TreeDataNode[],
  query: string
): Key[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: Key[] = []
  const visit = (node: TreeDataNode): void => {
    // We embedded the raw name into the title as plain text — the
    // first child of the title element. `String(node.key)` always
    // ends with the field name, but stripping it via the key path
    // is fragile, so we accept a partial match on the key too.
    const k = String(node.key).toLowerCase()
    if (k.includes(q)) out.push(node.key)
    if (node.children) {
      for (const c of node.children) visit(c)
    }
  }
  for (const n of nodes) visit(n)
  return out
}

/** Walk the tree and collect every node key on the path from the
 *  root to `targetKey` (inclusive). Returns the empty array when
 *  the target key isn't present in the tree. Used by `MappingTree`
 *  to expand all ancestors of a search hit so the user actually
 *  sees the matched node without having to expand by hand. */
export function pathToKey(nodes: TreeDataNode[], targetKey: Key): Key[] {
  const visit = (
    node: TreeDataNode,
    ancestors: Key[]
  ): Key[] | null => {
    const path = [...ancestors, node.key]
    if (node.key === targetKey) return path
    if (!node.children) return null
    for (const c of node.children) {
      const r = visit(c, path)
      if (r) return r
    }
    return null
  }
  for (const n of nodes) {
    const r = visit(n, [])
    if (r) return r
  }
  return []
}