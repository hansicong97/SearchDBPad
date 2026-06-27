/**
 * Long-running job progress publisher (V0.3.7 B-3).
 *
 * Imports and exports can take a while on big indices / files. To
 * keep the renderer responsive without blocking on `await`, the
 * main process pushes small status updates to the renderer over
 * dedicated IPC event channels (`import:progress`, `export:progress`)
 * using `webContents.send`. The renderer subscribes through
 * `esApi.importDocs.onProgress` / `esApi.exportDocs.onProgress` and
 * renders a progress bar + stage label + counters.
 *
 * Each event carries a `jobId` so the renderer can drop late or
 * out-of-order updates from a previous job (the user may have
 * started a new one before the previous one finished).
 *
 * Security note: `webContents.send` is the only outbound channel
 * for these updates. The renderer never reads from a path or
 * network here — the main process owns the data, the renderer
 * just paints it.
 */

import { BrowserWindow } from 'electron'
import type { ExportProgress, ImportProgress } from '../../shared/ipc'
import { IpcChannels } from '../../shared/ipc'

/** Send an import-progress update to the renderer. No-op when no
 *  window is open (e.g. the user closed the app mid-import). */
export function sendImportProgress(progress: ImportProgress): void {
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send(IpcChannels.ImportProgressEvent, progress)
}

/** Send an export-progress update to the renderer. Same no-op
 *  behaviour as `sendImportProgress`. */
export function sendExportProgress(progress: ExportProgress): void {
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send(IpcChannels.ExportProgressEvent, progress)
}