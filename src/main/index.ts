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

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
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
  createConnectionFolder,
  deleteConnection,
  deleteConnectionFolder,
  listConnections,
  listConnectionFolders,
  testConnection,
  updateConnection,
  updateConnectionFolder
} from './services/connection.service'
import { getClusterHealth, getClusterInfo } from './services/cluster.service'
import { searchEngineDetect } from './services/searchEngine.service'
import {
  closeIndex,
  createIndex,
  deleteIndex,
  getIndexMapping,
  getIndexSettings,
  listIndices,
  openIndex,
  updateIndexMapping,
  updateIndexSettings,
  getIndexShards,
  relocateShard,
  cancelShardAllocation
} from './services/index.service'
import {
  createDocument,
  deleteDocument,
  searchDocuments,
  updateDocument
} from './services/document.service'
import { runExport } from './services/export.service'
import { detectFormat, importPreview, runImport } from './services/import.service'
import {
  addAlias,
  deleteAlias,
  listAliases
} from './services/alias.service'
import {
  createIndexTemplate,
  deleteIndexTemplate,
  getIndexTemplate,
  listIndexTemplates
} from './services/template.service'
import {
  createDslFavorite,
  deleteDslFavorite,
  listDslFavorites,
  updateDslFavorite
} from './services/dslFavorite.service'

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
    title: 'SearchDBPad',
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

  /* Connection folders (phase 15 UI update) */
  ipcMain.handle(IpcChannels.ConnectionFolderList, () =>
    listConnectionFolders()
  )
  ipcMain.handle(IpcChannels.ConnectionFolderCreate, (_evt, input) =>
    createConnectionFolder(input)
  )
  ipcMain.handle(IpcChannels.ConnectionFolderUpdate, (_evt, input) =>
    updateConnectionFolder(input)
  )
  ipcMain.handle(IpcChannels.ConnectionFolderDelete, (_evt, id) =>
    deleteConnectionFolder(id)
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

  /* Index management (phase 13) */
  ipcMain.handle(IpcChannels.IndexCreate, (_evt, req) => createIndex(req))
  ipcMain.handle(IpcChannels.IndexDelete, (_evt, req) => deleteIndex(req))

  /* Index lifecycle (V0.3.1 A-1) */
  ipcMain.handle(IpcChannels.IndexClose, (_evt, req) => closeIndex(req))
  ipcMain.handle(IpcChannels.IndexOpen, (_evt, req) => openIndex(req))

  /* Index settings (V0.3.2 A-2) */
  ipcMain.handle(IpcChannels.IndexUpdateSettings, (_evt, req) =>
    updateIndexSettings(req)
  )

  /* Index mapping (V0.3.3 A-3) */
  ipcMain.handle(IpcChannels.IndexUpdateMapping, (_evt, req) =>
    updateIndexMapping(req)
  )

  /* Shard management (V0.3.9 E-7) */
  ipcMain.handle(IpcChannels.ShardList, (_evt, req) =>
    getIndexShards(req.connectionId, req.index)
  )
  ipcMain.handle(IpcChannels.ShardRelocate, (_evt, req) => relocateShard(req))
  ipcMain.handle(IpcChannels.ShardCancelAllocation, (_evt, req) =>
    cancelShardAllocation(req)
  )

  /* Alias management (V0.3.4 A-4) */
  ipcMain.handle(IpcChannels.AliasList, (_evt, ref) =>
    listAliases(ref.connectionId)
  )
  ipcMain.handle(IpcChannels.AliasAdd, (_evt, req) => addAlias(req))
  ipcMain.handle(IpcChannels.AliasDelete, (_evt, req) => deleteAlias(req))

  /* Index templates (V0.3.4 A-5) */
  ipcMain.handle(IpcChannels.IndexTemplateList, (_evt, ref) =>
    listIndexTemplates(ref.connectionId)
  )
  ipcMain.handle(IpcChannels.IndexTemplateGet, (_evt, req) =>
    getIndexTemplate(req)
  )
  ipcMain.handle(IpcChannels.IndexTemplateCreate, (_evt, req) =>
    createIndexTemplate(req)
  )
  ipcMain.handle(IpcChannels.IndexTemplateDelete, (_evt, req) =>
    deleteIndexTemplate(req)
  )

  /* DSL favorites (V0.3.5 B-4) */
  ipcMain.handle(IpcChannels.DslFavoriteList, () => listDslFavorites())
  ipcMain.handle(IpcChannels.DslFavoriteCreate, (_evt, input) =>
    createDslFavorite(input)
  )
  ipcMain.handle(IpcChannels.DslFavoriteUpdate, (_evt, input) =>
    updateDslFavorite(input)
  )
  ipcMain.handle(IpcChannels.DslFavoriteDelete, (_evt, id) =>
    deleteDslFavorite(id)
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

  /* Search engine metadata (V0.3.0 §10.2) */
  ipcMain.handle(IpcChannels.SearchEngineDetect, (_evt, connectionId: string) =>
    searchEngineDetect(connectionId)
  )
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

/**
 * Build the native application menu in Chinese. Without this, Electron
 * falls back to the OS default English menu (File / Edit / View / Window
 * / Help) which doesn't match a zh-CN UI.
 *
 * Editing-related items use built-in `role` values so accelerators and
 * labels stay in sync with the host OS language. Developer tools and the
 * reload commands are only exposed in dev builds.
 */
function buildAppMenu(dev: boolean): Menu {
  const viewSubmenu: MenuItemConstructorOptions[] = []
  if (dev) {
    viewSubmenu.push(
      { role: 'reload', label: '重新加载', accelerator: 'CmdOrCtrl+R' },
      {
        role: 'forceReload',
        label: '强制重载',
        accelerator: 'CmdOrCtrl+Shift+R'
      },
      {
        role: 'toggleDevTools',
        label: '切换开发者工具',
        accelerator: 'F12'
      },
      { type: 'separator' }
    )
  }
  viewSubmenu.push(
    { role: 'resetZoom', label: '重置缩放', accelerator: 'CmdOrCtrl+0' },
    { role: 'zoomIn', label: '放大', accelerator: 'CmdOrCtrl+=' },
    { role: 'zoomOut', label: '缩小', accelerator: 'CmdOrCtrl+-' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: '全屏', accelerator: 'F11' }
  )

  const windowSubmenu: MenuItemConstructorOptions[] = [
    { role: 'minimize', label: '最小化', accelerator: 'CmdOrCtrl+M' },
    { role: 'close', label: '关闭', accelerator: 'CmdOrCtrl+W' },
    { type: 'separator' },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: BrowserWindow.getFocusedWindow()?.isAlwaysOnTop() ?? false,
      click: (menuItem) => {
        const win = BrowserWindow.getFocusedWindow()
        if (!win) return
        const next = !menuItem.checked
        win.setAlwaysOnTop(next)
        menuItem.checked = next
      }
    }
  ]

  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit()
          }
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { role: 'delete', label: '删除' }
      ]
    },
    {
      label: '视图',
      submenu: viewSubmenu
    },
    {
      label: '窗口',
      submenu: windowSubmenu
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 SearchDBPad',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: '关于 SearchDBPad',
              message: `SearchDBPad ${app.getVersion()}`,
              detail:
                `搜索引擎数据管理桌面客户端\n` +
                `Electron ${process.versions.electron ?? 'unknown'}\n` +
                `Node ${process.versions.node ?? 'unknown'}\n` +
                `Chrome ${process.versions.chrome ?? 'unknown'}`,
              buttons: ['确定']
            })
          }
        }
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildAppMenu(isDev))
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
