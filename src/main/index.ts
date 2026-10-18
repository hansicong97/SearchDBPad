/**
 * Electron main process entry.
 *
 * Main-process responsibilities:
 *  - Create a single BrowserWindow with secure defaults.
 *  - Load the Vite dev server in development, the built index.html in production.
 *  - Register IPC handlers for the app info channels (phase 1), the
 *    connection management surface (phase 2), the cluster / index listing
 *    surface (phase 3), and the per-index mapping / settings surface
 *    (phase 4). All Elasticsearch calls run exclusively in the main
 *    process; the renderer never sees the network.
 *
 * IPC handlers delegate to engine-neutral services and optional adapter
 * capabilities; engine-specific request shapes remain inside adapters.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import path from 'node:path'
import { IpcChannels } from '../shared/ipc'
import type {
  ApiResponse,
  AppOpenSettingsEvent,
  ExportCancelRequest,
  ExportCancelResult,
  ExportPickPathRequest,
  ExportPickPathResult,
  ExportFormat,
  ImportCancelRequest,
  ImportCancelResult,
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
import { listEnabledAdapters } from './search/adapterRegistry'
import { getCapabilities, listResources, getResourceSchema, executeTask, inspectTask } from './services/resource.service'
import { handleResourceQuery, handleRequestCancel } from './services/resourceIpc.service'
import { cancelSenderRequests } from './search/requestRegistry'
import type { RequestCancelRequest, ResourceRequest, SearchQueryRequest, EngineTaskRequest, EngineTaskRef } from '../shared/ipc'
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
  refreshIndex,
  flushIndex,
  forceMergeIndex,
  clearIndexCache,
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
import {
  exportPathKey,
  isExportFormat,
  isUsableExportPath,
  sanitizeExportFileStem
} from './services/exportPath'
import { detectFormat, importPreview, runImport } from './services/import.service'
import { cancelAllJobs, hasActiveJobs, markCancelled, isJobActive, waitForAllJobs } from './services/jobCancel.service'
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
const approvedExportPaths = new Map<number, Set<string>>()

function rememberApprovedExportPath(senderId: number, filePath: string): void {
  const paths = approvedExportPaths.get(senderId) ?? new Set<string>()
  paths.add(exportPathKey(filePath))
  approvedExportPaths.set(senderId, paths)
}

function consumeApprovedExportPath(senderId: number, filePath: unknown): boolean {
  if (!isUsableExportPath(filePath)) return false
  const paths = approvedExportPaths.get(senderId)
  const key = exportPathKey(filePath)
  if (!paths?.has(key)) return false
  paths.delete(key)
  if (paths.size === 0) approvedExportPaths.delete(senderId)
  return true
}

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

  const senderId = win.webContents.id
  const cancelWindowWork = (): void => {
    approvedExportPaths.delete(senderId)
    cancelSenderRequests(senderId)
    // The application currently owns one workspace window and one job center.
    cancelAllJobs()
  }
  win.on('close', cancelWindowWork)
  win.webContents.on('destroyed', cancelWindowWork)
  win.webContents.on('render-process-gone', cancelWindowWork)

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

  /* Index maintenance (V0.3.12) */
  ipcMain.handle(IpcChannels.IndexRefresh, (_evt, req) => refreshIndex(req))
  ipcMain.handle(IpcChannels.IndexFlush, (_evt, req) => flushIndex(req))
  ipcMain.handle(IpcChannels.IndexForceMerge, (_evt, req) =>
    forceMergeIndex(req)
  )
  ipcMain.handle(IpcChannels.IndexClearCache, (_evt, req) =>
    clearIndexCache(req)
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
  ipcMain.handle(IpcChannels.ExportPickSavePath, async (evt, req: ExportPickPathRequest) => {
    const response = await pickExportSavePath(req)
    if (response.success && response.data?.outputPath) {
      rememberApprovedExportPath(evt.sender.id, response.data.outputPath)
    }
    return response
  })
  ipcMain.handle(IpcChannels.ExportExecute, (evt, req) => {
    if (!consumeApprovedExportPath(evt.sender.id, req?.outputPath)) {
      return {
        success: false,
        error: {
          code: 'invalid_request',
          operation: 'export:run',
          message: '请先通过保存对话框选择导出文件'
        }
      }
    }
    return runExport(req)
  })
  ipcMain.handle(IpcChannels.ExportCancel, (_evt, req: ExportCancelRequest) =>
    cancelExport(req)
  )

  /* Document import (phase 9) */
  ipcMain.handle(IpcChannels.ImportPickFile, (_evt, req: ImportPickFileRequest) =>
    pickImportFile(req)
  )
  ipcMain.handle(IpcChannels.ImportPreview, (_evt, req) => importPreview(req))
  ipcMain.handle(IpcChannels.ImportExecute, (_evt, req) => runImport(req))
  ipcMain.handle(IpcChannels.ImportCancel, (_evt, req: ImportCancelRequest) =>
    cancelImport(req)
  )

  /* Search engine metadata */
  ipcMain.handle(IpcChannels.SearchEngineDetect, (_evt, connectionId: string) =>
    searchEngineDetect(connectionId)
  )
  ipcMain.handle(IpcChannels.SearchEngineList, () => ({ success: true, data: { manifests: listEnabledAdapters() } }))
  ipcMain.handle(IpcChannels.SearchEngineCapabilities, (_evt, connectionId: string) => getCapabilities(connectionId))
  ipcMain.handle(IpcChannels.ResourceList, (_evt, connectionId: string) => listResources(connectionId))
  ipcMain.handle(IpcChannels.ResourceSchema, (_evt, request: ResourceRequest) => getResourceSchema(request))
  ipcMain.handle(IpcChannels.ResourceQuery, (evt, request: SearchQueryRequest) =>
    handleResourceQuery(evt.sender.id, request)
  )
  ipcMain.handle(IpcChannels.RequestCancel, (evt, request: RequestCancelRequest) => handleRequestCancel(evt.sender.id, request))
  ipcMain.handle(IpcChannels.TaskExecute, (_evt, request: EngineTaskRequest) => executeTask(request))
  ipcMain.handle(IpcChannels.TaskStatus, (_evt, request: EngineTaskRef) => inspectTask(request))
  ipcMain.handle(IpcChannels.TaskCancel, (_evt, request: EngineTaskRef) => inspectTask(request, true))
}

async function cancelExport(
  req: ExportCancelRequest
): Promise<ApiResponse<ExportCancelResult>> {
  const jobId = req.jobId?.trim()
  if (!jobId) {
    return { success: false, error: { message: '无效的任务 ID' } }
  }
  if (isJobActive(jobId)) markCancelled(jobId)
  return { success: true, data: { jobId, cancelled: isJobActive(jobId) } }
}

async function cancelImport(
  req: ImportCancelRequest
): Promise<ApiResponse<ImportCancelResult>> {
  const jobId = req.jobId?.trim()
  if (!jobId) {
    return { success: false, error: { message: '无效的任务 ID' } }
  }
  if (isJobActive(jobId)) markCancelled(jobId)
  return { success: true, data: { jobId, cancelled: isJobActive(jobId) } }
}

/** Open the OS save dialog and return the chosen file path. Returns
 *  `{ outputPath: null }` when the user cancels — the renderer treats
 *  that as a no-op rather than an error. */
async function pickExportSavePath(
  req: ExportPickPathRequest
): Promise<ApiResponse<ExportPickPathResult>> {
  if (!isExportFormat(req?.format)) {
    return {
      success: false,
      error: {
        code: 'invalid_request',
        operation: 'export:pickSavePath',
        message: '请求参数无效，请检查输入'
      }
    }
  }
  const ext: ExportFormat = req.format
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '_')
  const defaultName = `${sanitizeExportFileStem(req.index)}_${stamp}.${ext}`
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
 *  filter list's first entry is "all supported files" so the user
 *  sees JSON / NDJSON / CSV together and can pick any without
 *  switching filters. Optional `req.format` may promote the matching
 *  single-format filter to the top as a convenience, but the dialog
 *  always opens with the broadest filter selected. The format
 *  returned alongside is inferred from the extension of the chosen
 *  file (so the renderer does not have to re-derive it). */
async function pickImportFile(
  req: ImportPickFileRequest
): Promise<ApiResponse<ImportPickFileResult>> {
  const allFormats = ['json', 'ndjson', 'csv']
  // V0.3.10 F-2: build the canonical filter order. The first entry
  // is always "all supported files" so CSV / NDJSON are visible
  // without switching filters. If `req.format` is provided, the
  // matching single-format filter is placed right after the
  // catch-all for one-click access.
  const canonical: Array<{ name: string; extensions: string[] }> = [
    { name: '所有支持的文件', extensions: allFormats },
    { name: 'JSON 数组', extensions: ['json'] },
    { name: 'NDJSON', extensions: ['ndjson'] },
    { name: 'CSV', extensions: ['csv'] },
    { name: '所有文件', extensions: ['*'] }
  ]
  const singleExt = req.format
  const singleName =
    singleExt === 'json'
      ? 'JSON 数组'
      : singleExt === 'ndjson'
        ? 'NDJSON'
        : singleExt === 'csv'
          ? 'CSV'
          : null
  const filters = singleExt && singleName
    ? [
        canonical[0],
        { name: singleName, extensions: [singleExt] },
        ...canonical.slice(1)
      ]
    : canonical
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
          id: 'settings',
          label: '设置…',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
            if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
            const event: AppOpenSettingsEvent = { section: 'appearance' }
            win.webContents.send(IpcChannels.AppOpenSettingsEvent, event)
          }
        },
        { type: 'separator' },
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

let quitPending = false
app.on('before-quit', (event) => {
  if (!hasActiveJobs()) return
  event.preventDefault()
  if (quitPending) return
  quitPending = true
  cancelAllJobs()
  // Keep the main process alive until streams, scrolls and temporary files
  // have been released by the task finally blocks.
  void waitForAllJobs().then(() => {
    quitPending = false
    app.quit()
  })
})
