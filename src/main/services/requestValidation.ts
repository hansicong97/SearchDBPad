/** Runtime IPC checks. TypeScript types cannot validate renderer input. */
export function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid request object')
}

export function assertNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) throw new TypeError('Invalid request string')
}

/** Engine-specific naming rules remain in adapters. These characters cannot
 * safely identify one resource in an IPC request or URL path. */
export function assertResourceName(value: unknown): asserts value is string {
  assertNonEmptyString(value)
  if (value !== value.trim() || value === '.' || value === '..' || /[\\/#?]/.test(value)) throw new TypeError('Invalid resource name')
}

export function assertRequestSeq(value: unknown): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) throw new TypeError('Invalid request sequence')
}

export function assertCommitPolicy(value: unknown): void {
  if (value !== undefined && !['auto', 'commit', 'softCommit', 'none'].includes(value as string)) throw new TypeError('Invalid commit policy')
}

export function assertImportFileRequest(value: unknown): asserts value is { filePath: string; format: 'auto' | 'json' | 'csv' | 'ndjson' } {
  assertObject(value)
  assertNonEmptyString(value.filePath)
  if (!['auto', 'json', 'csv', 'ndjson'].includes(value.format as string)) throw new TypeError('Invalid import format')
}
