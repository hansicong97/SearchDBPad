/**
 * Electron main process entry.
 *
 * Phase 4 responsibilities:
 *  - Create a single BrowserWindow with secure defaults.
 *  - Load the Vite dev server in development, the built index.html in production.
 *  - Register IPC handlers for the app info channels (phase 1), the
 *    connection management surface (phase 2), the cluster / index listing
 *    surface (phase 3), and the per-index mapping / settings surface
 *    (phase 4). All Elasticsearch calls run exclusively in the main
 *    process; the renderer never sees the network.
 *
 * Business features beyond phase 4 (document query, CRUD, import/export)
 * are NOT implemented here. They will be added in later phases.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { IpcChannels } from '../shared/ipc'
import type {
  ApiResponse,
  ExportPickPathRequest,
  ExportPickPathResult,
  ImportFormat,
  ImportPickFileRequest,
  ImportPickFileResult
} from '../shared/ipc'
import {
  createConnection,
  deleteConnection,
  listConnections,
  testConnection,
  updateConnection
} from './services/connection.service'
import { getClusterHealth, getClusterInfo } from './services/cluster.service'
import {
  getIndexMapping,
  getIndexSettings,
  listIndices
} from './services/index.service'
import {
  createDocument,
  deleteDocument,
  searchDocuments,
  updateDocument
} from './services/document.service'
import { runExport } from './services/export.service'
import { detectFormat, importPreview, runImport } from './services/import.service'

const isDev = process.env.NODE_ENV === 'development'

function resolveRendererEntry(): { url?: string; file?: string } {
  if (isDev) {
    return { url: 'http://localhost:5173' }
  }
  return {
    file: path.join(__dirname, '..', 'renderer', 'index.html')
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#f5f5f5',
    title: 'ES Desktop Client',
    webPreferences: {
      // Security: required by phase 1 spec, must remain on in every phase.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload', 'index.js')
    }
  })

  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  const entry = resolveRendererEntry()
  if (entry.url) {
    void win.loadURL(entry.url)
  } else if (entry.file) {
    void win.loadFile(entry.file)
  }

  return win
}

function registerIpcHandlers(): void {
  /* App info (phase 1) */
  ipcMain.handle(IpcChannels.AppGetVersion, () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node ?? 'unknown'
  }))

  ipcMain.handle(IpcChannels.AppGetPlatform, () => ({
    platform: process.platform,
    arch: process.arch
  }))

  /* Connection management (phase 2) */
  ipcMain.handle(IpcChannels.ConnectionList, () => listConnections())
  ipcMain.handle(IpcChannels.ConnectionCreate, (_evt, input) =>
    createConnection(input)
  )
  ipcMain.handle(IpcChannels.ConnectionUpdate, (_evt, input) =>
    updateConnection(input)
  )
  ipcMain.handle(IpcChannels.ConnectionDelete, (_evt, id) =>
    deleteConnection(id)
  )
  ipcMain.handle(IpcChannels.ConnectionTest, (_evt, input) =>
    testConnection(input)
  )

  /* Cluster info and index list (phase 3) */
  ipcMain.handle(IpcChannels.ClusterInfo, (_evt, ref) =>
    getClusterInfo(ref.connectionId)
  )
  ipcMain.handle(IpcChannels.ClusterHealth, (_evt, ref) =>
    getClusterHealth(ref.connectionId)
  )
  ipcMain.handle(IpcChannels.IndexList, (_evt, ref) => listIndices(ref.connectionId))

  /* Index detail (phase 4) */
  ipcMain.handle(IpcChannels.IndexMapping, (_evt, req) =>
    getIndexMapping(req.connectionId, req.index)
  )
  ipcMain.handle(IpcChannels.IndexSettings, (_evt, req) =>
    getIndexSettings(req.connectionId, req.index)
  )

  /* Document search (phase 5) */
  ipcMain.handle(IpcChannels.DocumentSearch, (_evt, req) =>
    searchDocuments(req)
  )

  /* Document CRUD (phase 7) */
  ipcMain.handle(IpcChannels.DocumentCreate, (_evt, req) =>
    createDocument(req)
  )
  ipcMain.handle(IpcChannels.DocumentUpdate, (_evt, req) =>
    updateDocument(req)
  )
  ipcMain.handle(IpcChannels.DocumentDelete, (_evt, req) =>
    deleteDocument(req)
  )

  /* Document export (phase 8) */
  ipcMain.handle(IpcChannels.ExportPickSavePath, (_evt, req: ExportPickPathRequest) =>
    pickExportSavePath(req)
  )
  ipcMain.handle(IpcChannels.ExportExecute, (_evt, req) => runExport(req))

  /* Document import (phase 9) */
  ipcMain.handle(IpcChannels.ImportPickFile, (_evt, req: ImportPickFileRequest) =>
    pickImportFile(req)
  )
  ipcMain.handle(IpcChannels.ImportPreview, (_evt, req) => importPreview(req))
  ipcMain.handle(IpcChannels.ImportExecute, (_evt, req) => runImport(req))
}

/** Open the OS save dialog and return the chosen file path. Returns
 *  `{ outputPath: null }` when the user cancels — the renderer treats
 *  that as a no-op rather than an error. */
async function pickExportSavePath(
  req: ExportPickPathRequest
): Promise<ApiResponse<ExportPickPathResult>> {
  const ext = req.format
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '_')
  const defaultName = `${req.index}_${stamp}.${ext}`
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(win ?? undefined, {
    title: '导出查询结果',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [
      {
        name: req.format.toUpperCase(),
        extensions: [ext]
      },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (result.canceled || !result.filePath) {
    return { success: true, data: { outputPath: null } }
  }
  return { success: true, data: { outputPath: result.filePath } }
}

/** Open the OS open dialog and return the chosen file path. The
 *  filter list is built from the caller's hint about the expected
 *  format; the format returned alongside is inferred from the
 *  extension of the chosen file (so the renderer does not have to
 *  re-derive it). */
async function pickImportFile(
  req: ImportPickFileRequest
): Promise<ApiResponse<ImportPickFileResult>> {
  const allFormats = ['json', 'ndjson', 'csv']
  const singleName =
    req.format === 'json' ? 'JSON 数组' : req.format.toUpperCase()
  const filters = [
    { name: singleName, extensions: [req.format] },
    { name: '所有支持的文件', extensions: allFormats }
  ]
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: '选择导入文件',
    properties: ['openFile'],
    filters
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { success: true, data: { filePath: null, format: null } }
  }
  const filePath = result.filePaths[0]
  return {
    success: true,
    data: { filePath, format: detectFormat(filePath) }
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
