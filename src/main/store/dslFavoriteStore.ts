/**
 * DSL favorite persistence layer (V0.3.5 B-4).
 *
 * Wraps electron-store to read/write the local favorite list. The
 * store file lives in the platform's userData directory (managed
 * by electron), so saved data survives application restarts.
 *
 * The schema is a separate store file (`dsl-favorites.json`) from
 * the connection store to keep concerns isolated — connections and
 * favorites have very different lifecycles and the user is more
 * likely to want to import/export one without the other.
 */

import Store from 'electron-store'
import type { DslFavorite } from '../../shared/ipc'

interface DslFavoriteStoreSchema {
  favorites: DslFavorite[]
}

const store = new Store<DslFavoriteStoreSchema>({
  name: 'dsl-favorites',
  defaults: {
    favorites: []
  }
})

/** Return all persisted favorites, newest first by `createdAt`. The
 *  sort keeps the UI list stable across opens; users see the most
 *  recently created favorite at the top. */
export function loadDslFavorites(): DslFavorite[] {
  const list = store.get('favorites', [])
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Persist the full favorites list. The service layer is responsible
 *  for building the array — this function is a plain setter. */
export function saveDslFavorites(list: DslFavorite[]): void {
  store.set('favorites', list)
}
