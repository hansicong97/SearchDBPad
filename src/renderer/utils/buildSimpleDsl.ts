/**
 * DSL builder for the 简单查询 (simple query) tab.
 *
 * Phase 6 scope: map a single `(field, operator, value)` triple from the
 * form into the equivalent Elasticsearch `_search` body. No multi-clause
 * composition, no sort, no aggs — the form is deliberately the simple
 * path. Multi-clause / sort / DSL tricks still belong on the 查询 tab.
 *
 * The output is always of the shape `{ query: { <clause>: ... } }` so the
 * rest of the pipeline (`document:search` IPC → `document.service.ts`)
 * forwards it verbatim.
 */

/** Operators the form exposes. The labels are in `zh-CN` to match the UI. */
export type SimpleOperator =
  | 'term'
  | 'match'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'

export interface SimpleOperatorOption {
  value: SimpleOperator
  label: string
  /** Operators like `exists` ignore the value field. */
  requiresValue: boolean
}

export const SIMPLE_OPERATORS: SimpleOperatorOption[] = [
  { value: 'term', label: '等于', requiresValue: true },
  { value: 'match', label: '包含', requiresValue: true },
  { value: 'gt', label: '大于', requiresValue: true },
  { value: 'gte', label: '大于等于', requiresValue: true },
  { value: 'lt', label: '小于', requiresValue: true },
  { value: 'lte', label: '小于等于', requiresValue: true },
  { value: 'exists', label: '存在', requiresValue: false }
]

/** Best-effort string-to-native coercion. Anything we can't recognize
 *  stays a string. Term + range queries hit this so that `term: age = 18`
 *  matches a numeric field instead of always comparing strings. */
export function coerceSimpleValue(raw: string): unknown {
  const v = raw.trim()
  if (v === '') return ''
  if (v === 'null') return null
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+$/.test(v)) {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : v
  }
  if (/^-?\d+\.\d+$/.test(v)) {
    const n = Number.parseFloat(v)
    return Number.isFinite(n) ? n : v
  }
  return v
}

/** Build a `_search` body from a single clause. Returns `null` when the
 *  field name is empty (form-level validation should prevent this, but
 *  the builder is the last line of defense). */
export function buildSimpleDsl(
  field: string,
  operator: SimpleOperator,
  value: string
): Record<string, unknown> | null {
  const trimmed = field.trim()
  if (!trimmed) return null

  switch (operator) {
    case 'term':
      return { query: { term: { [trimmed]: coerceSimpleValue(value) } } }
    case 'match':
      return { query: { match: { [trimmed]: value } } }
    case 'gt':
      return {
        query: { range: { [trimmed]: { gt: coerceSimpleValue(value) } } }
      }
    case 'gte':
      return {
        query: { range: { [trimmed]: { gte: coerceSimpleValue(value) } } }
      }
    case 'lt':
      return {
        query: { range: { [trimmed]: { lt: coerceSimpleValue(value) } } }
      }
    case 'lte':
      return {
        query: { range: { [trimmed]: { lte: coerceSimpleValue(value) } } }
      }
    case 'exists':
      // `exists` only cares about the field path.
      return { query: { exists: { field: trimmed } } }
  }
}