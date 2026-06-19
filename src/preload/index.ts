/**
 * Preload script.
 *
 * Runs in an isolated context with access to a limited Node API. We expose a
 * small, typed `esApi` object to the renderer through contextBridge so the
 * renderer can call into the main process without ever touching Node directly.
 *
 * Phase 7 surfaces:
 *   - `connections`  (phase 2) — connection CRUD + test
 *   - `cluster`      (phase 3) — root info + cluster health
 *   - `indices`      (phase 3 + 4) — list, mapping, settings
 *   - `documents`    (phase 5 + 7) — search, create, update, delete
 *
 * The renderer never sees the filesystem, network, or Node APIs.
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  type ApiResponse,
  type AppPlatformResult,
  type AppVersionResult,
  type ClusterHealth,
  type ClusterInfo,
  type ConnectionRef,
  type ConnectionTestResult,
  type DocumentDeleteRequest,
  type DocumentDeleteResult,
  type DocumentSearchRequest,
  type DocumentSearchResult,
  type DocumentWriteRequest,
  type DocumentWriteResult,
  type EsConnection,
  type EsConnectionInput,
  type ExportPickPathRequest,
  type ExportPickPathResult,
  type ExportRequest,
  type ExportResult,
  type ImportExecuteRequest,
  type ImportExecuteResult,
  type ImportPickFileRequest,
  type ImportPickFileResult,
  type ImportPreviewRequest,
  type ImportPreviewResult,
  type IndexCreateRequest,
  type IndexCreateResult,
  type IndexDeleteRequest,
  type IndexDeleteResult,
  type IndexDetailRequest,
  type IndexListResult,
  type IndexMappingResult,
  type IndexSettingsResult
} from '../shared/ipc'

const api = {
  getAppInfo: (): Promise<AppVersionResult> =>
    ipcRenderer.invoke(IpcChannels.AppGetVersion) as Promise<AppVersionResult>,
  getPlatform: (): Promise<AppPlatformResult> =>
    ipcRenderer.invoke(IpcChannels.AppGetPlatform) as Promise<AppPlatformResult>,

  connections: {
    list: (): Promise<ApiResponse<EsConnection[]>> =>
      ipcRenderer.invoke(IpcChannels.ConnectionList) as Promise<
        ApiResponse<EsConnection[]>
      >,
    create: (input: EsConnectionInput): Promise<ApiResponse<EsConnection>> =>
      ipcRenderer.invoke(
        IpcChannels.ConnectionCreate,
        input
      ) as Promise<ApiResponse<EsConnection>>,
    update: (input: EsConnectionInput): Promise<ApiResponse<EsConnection>> =>
      ipcRenderer.invoke(
        IpcChannels.ConnectionUpdate,
        input
      ) as Promise<ApiResponse<EsConnection>>,
    delete: (id: string): Promise<ApiResponse<{ id: string }>> =>
      ipcRenderer.invoke(
        IpcChannels.ConnectionDelete,
        id
      ) as Promise<ApiResponse<{ id: string }>>,
    test: (
      input: EsConnectionInput
    ): Promise<ApiResponse<ConnectionTestResult>> =>
      ipcRenderer.invoke(
        IpcChannels.ConnectionTest,
        input
      ) as Promise<ApiResponse<ConnectionTestResult>>
  },

  cluster: {
    info: (
      ref: ConnectionRef
    ): Promise<ApiResponse<ClusterInfo>> =>
      ipcRenderer.invoke(
        IpcChannels.ClusterInfo,
        ref
      ) as Promise<ApiResponse<ClusterInfo>>,
    health: (
      ref: ConnectionRef
    ): Promise<ApiResponse<ClusterHealth>> =>
      ipcRenderer.invoke(
        IpcChannels.ClusterHealth,
        ref
      ) as Promise<ApiResponse<ClusterHealth>>
  },

  indices: {
    list: (ref: ConnectionRef): Promise<ApiResponse<IndexListResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexList,
        ref
      ) as Promise<ApiResponse<IndexListResult>>,
    mapping: (
      req: IndexDetailRequest
    ): Promise<ApiResponse<IndexMappingResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexMapping,
        req
      ) as Promise<ApiResponse<IndexMappingResult>>,
    settings: (
      req: IndexDetailRequest
    ): Promise<ApiResponse<IndexSettingsResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexSettings,
        req
      ) as Promise<ApiResponse<IndexSettingsResult>>,
    create: (
      req: IndexCreateRequest
    ): Promise<ApiResponse<IndexCreateResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexCreate,
        req
      ) as Promise<ApiResponse<IndexCreateResult>>,
    delete: (
      req: IndexDeleteRequest
    ): Promise<ApiResponse<IndexDeleteResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexDelete,
        req
      ) as Promise<ApiResponse<IndexDeleteResult>>
  },

  documents: {
    search: (
      req: DocumentSearchRequest
    ): Promise<ApiResponse<DocumentSearchResult>> =>
      ipcRenderer.invoke(
        IpcChannels.DocumentSearch,
        req
      ) as Promise<ApiResponse<DocumentSearchResult>>,
    create: (
      req: DocumentWriteRequest
    ): Promise<ApiResponse<DocumentWriteResult>> =>
      ipcRenderer.invoke(
        IpcChannels.DocumentCreate,
        req
      ) as Promise<ApiResponse<DocumentWriteResult>>,
    update: (
      req: DocumentWriteRequest
    ): Promise<ApiResponse<DocumentWriteResult>> =>
      ipcRenderer.invoke(
        IpcChannels.DocumentUpdate,
        req
      ) as Promise<ApiResponse<DocumentWriteResult>>,
    delete: (
      req: DocumentDeleteRequest
    ): Promise<ApiResponse<DocumentDeleteResult>> =>
      ipcRenderer.invoke(
        IpcChannels.DocumentDelete,
        req
      ) as Promise<ApiResponse<DocumentDeleteResult>>
  },

  exportDocs: {
    pickSavePath: (
      req: ExportPickPathRequest
    ): Promise<ApiResponse<ExportPickPathResult>> =>
      ipcRenderer.invoke(
        IpcChannels.ExportPickSavePath,
        req
      ) as Promise<ApiResponse<ExportPickPathResult>>,
    execute: (
      req: ExportRequest
    ): Promise<ApiResponse<ExportResult>> =>
      ipcRenderer.invoke(
        IpcChannels.ExportExecute,
        req
      ) as Promise<ApiResponse<ExportResult>>
  },

  importDocs: {
    pickFile: (
      req: ImportPickFileRequest
    ): Promise<ApiResponse<ImportPickFileResult>> =>
      ipcRenderer.invoke(
        IpcChannels.ImportPickFile,
        req
      ) as Promise<ApiResponse<ImportPickFileResult>>,
    preview: (
      req: ImportPreviewRequest
    ): Promise<ApiResponse<ImportPreviewResult>> =>
      ipcRenderer.invoke(
        IpcChannels.ImportPreview,
        req
      ) as Promise<ApiResponse<ImportPreviewResult>>,
    execute: (
      req: ImportExecuteRequest
    ): Promise<ApiResponse<ImportExecuteResult>> =>
      ipcRenderer.invoke(
        IpcChannels.ImportExecute,
        req
      ) as Promise<ApiResponse<ImportExecuteResult>>
  }
}

contextBridge.exposeInMainWorld('esApi', api)

export type EsApi = typeof api
