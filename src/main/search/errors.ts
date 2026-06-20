/**
 * Search-engine error model.
 *
 * V0.3.0 introduces this single error class so every adapter can throw
 * the same shape regardless of which engine it wraps. The IPC layer
 * serializes via `toJSON()` and the renderer surfaces `message` to
 * users while keeping `details` available for debugging.
 *
 * Engine-specific quirks (e.g. ES 6.x mapping-type errors vs Solr
 * schema-mismatch errors) stay inside the adapter's branch — only the
 * normalized code is exposed here.
 */

import type { SearchEngineType } from '../../shared/searchEngine'

/** Stable error codes the renderer / service layer can switch on.
 *  Adapter-specific codes (e.g. ES `mapper_parsing_exception`) belong
 *  in `details`, not here. */
export type SearchEngineErrorCode =
  | 'unsupported_capability'
  | 'http_error'
  | 'network_error'
  | 'timeout'
  | 'parse_error'
  | 'auth_failed'

/** Serializable shape of `SearchEngineError`. Mirrors the public
 *  type the spec calls out in V0.3.0 §7.2. */
export interface SearchEngineErrorShape {
  engineType: SearchEngineType
  status?: number
  code?: SearchEngineErrorCode
  message: string
  details?: unknown
}

export class SearchEngineError extends Error {
  readonly engineType: SearchEngineType
  readonly status?: number
  readonly code?: SearchEngineErrorCode
  readonly details?: unknown

  constructor(shape: SearchEngineErrorShape) {
    super(shape.message)
    this.name = 'SearchEngineError'
    this.engineType = shape.engineType
    this.status = shape.status
    this.code = shape.code
    this.details = shape.details
  }

  /** Wire shape — used by `ApiResponse.error` in `shared/ipc.ts`. */
  toJSON(): SearchEngineErrorShape {
    return {
      engineType: this.engineType,
      status: this.status,
      code: this.code,
      message: this.message,
      details: this.details
    }
  }
}

/** Convenience: pick the right code from a HTTP status. */
export function codeFromHttpStatus(status: number): SearchEngineErrorCode {
  if (status === 401 || status === 403) return 'auth_failed'
  if (status === 408 || status === 504) return 'timeout'
  return 'http_error'
}