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
  type ConnectionFolder,
  type ConnectionFolderInput,
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
  type ExportProgress,
  type ExportRequest,
  type ExportResult,
  type ImportExecuteRequest,
  type ImportExecuteResult,
  type ImportPickFileRequest,
  type ImportPickFileResult,
  type ImportPreviewRequest,
  type ImportPreviewResult,
  type ImportProgress,
  type AliasListResult,
  type AliasModifyRequest,
  type AliasModifyResult,
  type IndexCreateRequest,
  type IndexCreateResult,
  type IndexDeleteRequest,
  type IndexDeleteResult,
  type IndexDetailRequest,
  type IndexLifecycleRequest,
  type IndexLifecycleResult,
  type IndexListResult,
  type IndexMappingResult,
  type IndexSettingsResult,
  type IndexTemplateCreateRequest,
  type IndexTemplateDeleteRequest,
  type IndexTemplateGetRequest,
  type IndexTemplateGetResult,
  type IndexTemplateListResult,
  type IndexTemplateModifyResult,
  type IndexUpdateMappingRequest,
  type IndexUpdateMappingResult,
  type IndexUpdateSettingsRequest,
  type IndexUpdateSettingsResult,
  type ShardCancelRequest,
  type ShardListResult,
  type ShardRelocateRequest,
  type ShardRerouteResult
} from '../shared/ipc'
import type { SearchEngineServerInfo } from '../shared/searchEngine'
import type { DslFavorite, DslFavoriteInput } from '../shared/ipc'

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

  connectionFolders: {
    list: (): Promise<ApiResponse<ConnectionFolder[]>> =>
      ipcRenderer.invoke(
        IpcChannels.ConnectionFolderList
      ) as Promise<ApiResponse<ConnectionFolder[]>>,
    create: (
      input: ConnectionFolderInput
    ): Promise<ApiResponse<ConnectionFolder>> =>
      ipcRenderer.invoke(
        IpcChannels.ConnectionFolderCreate,
        input
      ) as Promise<ApiResponse<ConnectionFolder>>,
    update: (
      input: ConnectionFolderInput
    ): Promise<ApiResponse<ConnectionFolder>> =>
      ipcRenderer.invoke(
        IpcChannels.ConnectionFolderUpdate,
        input
      ) as Promise<ApiResponse<ConnectionFolder>>,
    delete: (id: string): Promise<ApiResponse<{ id: string }>> =>
      ipcRenderer.invoke(
        IpcChannels.ConnectionFolderDelete,
        id
      ) as Promise<ApiResponse<{ id: string }>>
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
      ) as Promise<ApiResponse<IndexDeleteResult>>,
    close: (
      req: IndexLifecycleRequest
    ): Promise<ApiResponse<IndexLifecycleResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexClose,
        req
      ) as Promise<ApiResponse<IndexLifecycleResult>>,
    open: (
      req: IndexLifecycleRequest
    ): Promise<ApiResponse<IndexLifecycleResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexOpen,
        req
      ) as Promise<ApiResponse<IndexLifecycleResult>>,
    updateSettings: (
      req: IndexUpdateSettingsRequest
    ): Promise<ApiResponse<IndexUpdateSettingsResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexUpdateSettings,
        req
      ) as Promise<ApiResponse<IndexUpdateSettingsResult>>,
    updateMapping: (
      req: IndexUpdateMappingRequest
    ): Promise<ApiResponse<IndexUpdateMappingResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexUpdateMapping,
        req
      ) as Promise<ApiResponse<IndexUpdateMappingResult>>,
    /** V0.3.9 E-7: list shards for a single index. */
    shards: (
      req: IndexDetailRequest
    ): Promise<ApiResponse<ShardListResult>> =>
      ipcRenderer.invoke(
        IpcChannels.ShardList,
        req
      ) as Promise<ApiResponse<ShardListResult>>,
    /** V0.3.9 E-7: relocate a started shard between two nodes. */
    relocateShard: (
      req: ShardRelocateRequest
    ): Promise<ApiResponse<ShardRerouteResult>> =>
      ipcRenderer.invoke(
        IpcChannels.ShardRelocate,
        req
      ) as Promise<ApiResponse<ShardRerouteResult>>,
    /** V0.3.9 E-7: cancel the allocation of an unassigned shard. */
    cancelShardAllocation: (
      req: ShardCancelRequest
    ): Promise<ApiResponse<ShardRerouteResult>> =>
      ipcRenderer.invoke(
        IpcChannels.ShardCancelAllocation,
        req
      ) as Promise<ApiResponse<ShardRerouteResult>>
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
      ) as Promise<ApiResponse<ExportResult>>,
    /** V0.3.7 B-3: subscribe to export progress events. Returns
     *  an unsubscribe function — callers should call it on
     *  unmount to avoid leaking listeners. */
    onProgress: (cb: (progress: ExportProgress) => void): (() => void) => {
      const handler = (_evt: unknown, progress: ExportProgress): void =>
        cb(progress)
      ipcRenderer.on(IpcChannels.ExportProgressEvent, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannels.ExportProgressEvent, handler)
      }
    }
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
      ) as Promise<ApiResponse<ImportExecuteResult>>,
    /** V0.3.7 B-3: subscribe to import progress events. Returns
     *  an unsubscribe function. */
    onProgress: (cb: (progress: ImportProgress) => void): (() => void) => {
      const handler = (_evt: unknown, progress: ImportProgress): void =>
        cb(progress)
      ipcRenderer.on(IpcChannels.ImportProgressEvent, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannels.ImportProgressEvent, handler)
      }
    }
  },

  /* Search engine metadata (V0.3.0 §10.2). */
  searchEngine: {
    detect: (
      connectionId: string
    ): Promise<ApiResponse<SearchEngineServerInfo>> =>
      ipcRenderer.invoke(
        IpcChannels.SearchEngineDetect,
        connectionId
      ) as Promise<ApiResponse<SearchEngineServerInfo>>
  },

  /* Alias management (V0.3.4 A-4) */
  aliases: {
    list: (
      ref: ConnectionRef
    ): Promise<ApiResponse<AliasListResult>> =>
      ipcRenderer.invoke(
        IpcChannels.AliasList,
        ref
      ) as Promise<ApiResponse<AliasListResult>>,
    add: (
      req: AliasModifyRequest
    ): Promise<ApiResponse<AliasModifyResult>> =>
      ipcRenderer.invoke(
        IpcChannels.AliasAdd,
        req
      ) as Promise<ApiResponse<AliasModifyResult>>,
    delete: (
      req: AliasModifyRequest
    ): Promise<ApiResponse<AliasModifyResult>> =>
      ipcRenderer.invoke(
        IpcChannels.AliasDelete,
        req
      ) as Promise<ApiResponse<AliasModifyResult>>
  },

  /* Index templates (V0.3.4 A-5) */
  indexTemplates: {
    list: (
      ref: ConnectionRef
    ): Promise<ApiResponse<IndexTemplateListResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexTemplateList,
        ref
      ) as Promise<ApiResponse<IndexTemplateListResult>>,
    get: (
      req: IndexTemplateGetRequest
    ): Promise<ApiResponse<IndexTemplateGetResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexTemplateGet,
        req
      ) as Promise<ApiResponse<IndexTemplateGetResult>>,
    create: (
      req: IndexTemplateCreateRequest
    ): Promise<ApiResponse<IndexTemplateModifyResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexTemplateCreate,
        req
      ) as Promise<ApiResponse<IndexTemplateModifyResult>>,
    delete: (
      req: IndexTemplateDeleteRequest
    ): Promise<ApiResponse<IndexTemplateModifyResult>> =>
      ipcRenderer.invoke(
        IpcChannels.IndexTemplateDelete,
        req
      ) as Promise<ApiResponse<IndexTemplateModifyResult>>
  },

  /* DSL favorites (V0.3.5 B-4) */
  dslFavorites: {
    list: (): Promise<ApiResponse<DslFavorite[]>> =>
      ipcRenderer.invoke(
        IpcChannels.DslFavoriteList
      ) as Promise<ApiResponse<DslFavorite[]>>,
    create: (
      input: DslFavoriteInput
    ): Promise<ApiResponse<DslFavorite>> =>
      ipcRenderer.invoke(
        IpcChannels.DslFavoriteCreate,
        input
      ) as Promise<ApiResponse<DslFavorite>>,
    update: (
      input: DslFavoriteInput
    ): Promise<ApiResponse<DslFavorite>> =>
      ipcRenderer.invoke(
        IpcChannels.DslFavoriteUpdate,
        input
      ) as Promise<ApiResponse<DslFavorite>>,
    delete: (id: string): Promise<ApiResponse<{ id: string }>> =>
      ipcRenderer.invoke(
        IpcChannels.DslFavoriteDelete,
        id
      ) as Promise<ApiResponse<{ id: string }>>
  }
}

contextBridge.exposeInMainWorld('esApi', api)

export type EsApi = typeof api
