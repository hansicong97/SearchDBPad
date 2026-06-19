/**
 * Monaco Editor worker + loader wiring.
 *
 * `monaco-editor` ships its own web workers (one per language service).
 * The official Vite story is to import them with the `?worker` suffix so
 * Vite emits a separate worker bundle, then route Monaco's worker requests
 * via `window.MonacoEnvironment.getWorker`.
 *
 * We only need the JSON language worker for the DSL editor, plus the
 * generic editor worker as the fallback. Importing additional language
 * workers (typescript, html, css, ...) is unnecessary for phase 5.
 *
 * Importing this file also registers the local monaco package with
 * `@monaco-editor/react` via `loader.config({ monaco })`, which keeps the
 * editor fully offline (no CDN fetch). The electron-builder wiring to
 * keep Monaco's assets inside the packaged app is left to phase 10.
 */

import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import { loader } from '@monaco-editor/react'

window.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'json') {
      return new JsonWorker()
    }
    return new EditorWorker()
  }
}

loader.config({ monaco })

// `monaco-editor` is imported only so `loader.config` receives the local
// instance; the namespace isn't otherwise referenced.
void monaco

export {} // ensure this file is treated as a module