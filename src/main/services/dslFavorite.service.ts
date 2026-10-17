/**
 * DSL favorite business logic (V0.3.5 B-4).
 *
 * Thin CRUD layer over `dslFavoriteStore`. We translate thrown
 * errors into the project's standard safe `ApiResponse` envelope. Local
 * validation messages remain actionable; persistence failures are mapped
 * without exposing raw exceptions or file details.
 *
 * Validation rules (per the V0.3.5 plan):
 *  - `name` is required and non-blank.
 *  - `dsl` must be a valid JSON object string (arrays / primitives
 *    are rejected — DSL queries are always a `_search` body).
 *  - `id` is required for update.
 *
 * Validation errors are returned as `success: false` with a
 * descriptive message; the renderer's modal can display the
 * message inline next to the offending field.
 */

import { randomUUID } from 'node:crypto'
import {
  loadDslFavorites,
  saveDslFavorites
} from '../store/dslFavoriteStore'
import type {
  ApiResponse,
  DslFavorite,
  DslFavoriteInput
} from '../../shared/ipc'
import { toPublicSearchError, type PublicSearchError } from '../search/errors'

class DslFavoriteValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DslFavoriteValidationError'
  }
}

function publicFavoriteError(error: unknown, operation: string): PublicSearchError {
  if (error instanceof DslFavoriteValidationError) {
    return { code: 'invalid_request', operation, message: error.message }
  }
  return toPublicSearchError(error, operation)
}

function validationError(message: string): never {
  throw new DslFavoriteValidationError(message)
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Returns the parsed DSL object on success; throws with a
 *  user-facing message on validation failure. The caller wraps
 *  any throw in an `ApiResponse` error envelope. */
function validateAndParse(input: DslFavoriteInput): Record<string, unknown> {
  if (!input.name || !input.name.trim()) {
    validationError('收藏名称不能为空')
  }
  if (typeof input.dsl !== 'string') {
    validationError('DSL 内容缺失')
  }
  const trimmed = input.dsl.trim()
  if (!trimmed) {
    validationError('DSL 内容不能为空')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    validationError('DSL JSON 格式无效，请检查输入')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    validationError('DSL 必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

export function listDslFavorites(): ApiResponse<DslFavorite[]> {
  try {
    return { success: true, data: loadDslFavorites() }
  } catch (err) {
    return { success: false, error: publicFavoriteError(err, 'dsl-favorite:list') }
  }
}

export function createDslFavorite(
  input: DslFavoriteInput
): ApiResponse<DslFavorite> {
  try {
    // The parser double-validates: ensure any caller-supplied id
    // is rejected on create. We generate the id ourselves.
    if (input.id) {
      validationError('创建收藏时不能携带 id')
    }
    validateAndParse(input)
    const favorite: DslFavorite = {
      id: randomUUID(),
      name: input.name.trim(),
      indexName: input.indexName?.trim() ?? '',
      dsl: input.dsl,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
    const list = loadDslFavorites()
    // Unique-name rule mirrors the connection-folder pattern: two
    // favorites with the same trimmed name would be confusing in
    // the dropdown.
    if (
      list.some(
        (f) => f.name.trim().toLowerCase() === favorite.name.toLowerCase()
      )
    ) {
      validationError('收藏名称已存在')
    }
    list.push(favorite)
    saveDslFavorites(list)
    return { success: true, data: favorite }
  } catch (err) {
    return { success: false, error: publicFavoriteError(err, 'dsl-favorite:create') }
  }
}

export function updateDslFavorite(
  input: DslFavoriteInput
): ApiResponse<DslFavorite> {
  try {
    if (!input.id) {
      validationError('更新收藏时缺少 id')
    }
    validateAndParse(input)
    const list = loadDslFavorites()
    const idx = list.findIndex((f) => f.id === input.id)
    if (idx < 0) {
      validationError('未找到对应收藏')
    }
    const name = input.name.trim()
    if (
      list.some(
        (f) =>
          f.id !== input.id &&
          f.name.trim().toLowerCase() === name.toLowerCase()
      )
    ) {
      validationError('收藏名称已存在')
    }
    const merged: DslFavorite = {
      ...list[idx],
      name,
      indexName: input.indexName?.trim() ?? '',
      dsl: input.dsl,
      updatedAt: nowIso()
    }
    list[idx] = merged
    saveDslFavorites(list)
    return { success: true, data: merged }
  } catch (err) {
    return { success: false, error: publicFavoriteError(err, 'dsl-favorite:update') }
  }
}

export function deleteDslFavorite(
  id: string
): ApiResponse<{ id: string }> {
  try {
    const list = loadDslFavorites()
    const next = list.filter((f) => f.id !== id)
    if (next.length === list.length) {
      return { success: false, error: {
        code: 'resource_not_found',
        operation: 'dsl-favorite:delete',
        message: '未找到对应收藏，请刷新后重试'
      } }
    }
    saveDslFavorites(next)
    return { success: true, data: { id } }
  } catch (err) {
    return { success: false, error: publicFavoriteError(err, 'dsl-favorite:delete') }
  }
}
