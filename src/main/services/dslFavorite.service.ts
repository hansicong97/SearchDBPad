/**
 * DSL favorite business logic (V0.3.5 B-4).
 *
 * Thin CRUD layer over `dslFavoriteStore`. We translate thrown
 * errors into the project's standard `ApiResponse` envelope so
 * the renderer can show server / validation messages verbatim.
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

function nowIso(): string {
  return new Date().toISOString()
}

/** Returns the parsed DSL object on success; throws with a
 *  user-facing message on validation failure. The caller wraps
 *  any throw in an `ApiResponse` error envelope. */
function validateAndParse(input: DslFavoriteInput): Record<string, unknown> {
  if (!input.name || !input.name.trim()) {
    throw new Error('收藏名称不能为空')
  }
  if (typeof input.dsl !== 'string') {
    throw new Error('DSL 内容缺失')
  }
  const trimmed = input.dsl.trim()
  if (!trimmed) {
    throw new Error('DSL 内容不能为空')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    throw new Error(
      `DSL JSON 解析失败：${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DSL 必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

export function listDslFavorites(): ApiResponse<DslFavorite[]> {
  try {
    return { success: true, data: loadDslFavorites() }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

export function createDslFavorite(
  input: DslFavoriteInput
): ApiResponse<DslFavorite> {
  try {
    // The parser double-validates: ensure any caller-supplied id
    // is rejected on create. We generate the id ourselves.
    if (input.id) {
      throw new Error('创建收藏时不能携带 id')
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
      throw new Error('收藏名称已存在')
    }
    list.push(favorite)
    saveDslFavorites(list)
    return { success: true, data: favorite }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}

export function updateDslFavorite(
  input: DslFavoriteInput
): ApiResponse<DslFavorite> {
  try {
    if (!input.id) {
      throw new Error('更新收藏时缺少 id')
    }
    validateAndParse(input)
    const list = loadDslFavorites()
    const idx = list.findIndex((f) => f.id === input.id)
    if (idx < 0) {
      throw new Error('未找到对应收藏')
    }
    const name = input.name.trim()
    if (
      list.some(
        (f) =>
          f.id !== input.id &&
          f.name.trim().toLowerCase() === name.toLowerCase()
      )
    ) {
      throw new Error('收藏名称已存在')
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
    return { success: false, error: { message: (err as Error).message } }
  }
}

export function deleteDslFavorite(
  id: string
): ApiResponse<{ id: string }> {
  try {
    const list = loadDslFavorites()
    const next = list.filter((f) => f.id !== id)
    if (next.length === list.length) {
      return { success: false, error: { message: '未找到对应收藏' } }
    }
    saveDslFavorites(next)
    return { success: true, data: { id } }
  } catch (err) {
    return { success: false, error: { message: (err as Error).message } }
  }
}
