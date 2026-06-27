/**
 * Top-level app shell.
 *
 * Phase 3 layout: a left sidebar listing saved connections (with create /
 * edit / delete / test actions) and a main area that swaps to the
 * workspace page when a connection is selected. The connection management
 * form modal lives here so any child can open it through callbacks.
 */

import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Layout, Space, Tag, Typography } from 'antd'
import AppHeader from './components/AppHeader'
import AppSidebar from './components/AppSidebar'
import ConnectionForm, {
  type ConnectionFormValues
} from './components/ConnectionForm'
import ConnectionFolderModal, {
  type ConnectionFolderFormValues
} from './components/ConnectionFolderModal'
import WorkspacePage from './pages/WorkspacePage'
import { useConnectionStore } from './stores/connection.store'
import { useWorkspaceStore } from './stores/workspace.store'
import { useThemeStore } from './stores/theme.store'
import type {
  ConnectionFolder,
  ConnectionTestResult,
  EsConnection
} from '@shared/ipc'

const { Content, Footer, Sider } = Layout
const { Text } = Typography

function App(): JSX.Element {
  const { message, modal } = AntdApp.useApp()

  const connections = useConnectionStore((s) => s.connections)
  const loading = useConnectionStore((s) => s.loading)
  const error = useConnectionStore((s) => s.error)
  const lastTestResult = useConnectionStore((s) => s.lastTestResult)
  const folderError = useConnectionStore((s) => s.folderError)
  const fetchConnections = useConnectionStore((s) => s.fetch)
  const createConnection = useConnectionStore((s) => s.create)
  const updateConnection = useConnectionStore((s) => s.update)
  const removeConnection = useConnectionStore((s) => s.remove)
  const testConnection = useConnectionStore((s) => s.test)
  // V0.3.9 E-3: lightweight move-to-folder action used by drag
  // and the row menu's "移动到目录" submenu.
  const moveConnectionToFolder = useConnectionStore(
    (s) => s.moveConnectionToFolder
  )

  const folders = useConnectionStore((s) => s.folders)
  const fetchFolders = useConnectionStore((s) => s.fetchFolders)
  const createFolder = useConnectionStore((s) => s.createFolder)
  const updateFolder = useConnectionStore((s) => s.updateFolder)
  const removeFolder = useConnectionStore((s) => s.removeFolder)

  const activeId = useWorkspaceStore((s) => s.activeConnectionId)
  const setActive = useWorkspaceStore((s) => s.setActiveConnection)
  const clearWorkspace = useWorkspaceStore((s) => s.clear)
  // V0.3.5 B-4: DSL favorites are global (not per-connection),
  // so we fetch them once at app start. The DslFavoriteModal also
  // re-fetches on open so concurrent edits from another panel are
  // picked up.
  const fetchDslFavorites = useWorkspaceStore((s) => s.fetchDslFavorites)

  const themeMode = useThemeStore((s) => s.mode)
  const isDark = themeMode === 'dark'

  const [editing, setEditing] = useState<EsConnection | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [formTesting, setFormTesting] = useState(false)
  const [formTestError, setFormTestError] = useState<string | null>(null)
  const [formTestResult, setFormTestResult] =
    useState<ConnectionTestResult | null>(null)

  const [editingFolder, setEditingFolder] = useState<ConnectionFolder | null>(
    null
  )
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  // V0.3.9 E-4: when opening the modal from a folder's "新建子目录"
  // menu, the parent id is captured here and threaded through to
  // the modal. `null` means a top-level create.
  const [folderParentId, setFolderParentId] = useState<string | null>(null)

  useEffect(() => {
    void fetchConnections()
    void fetchFolders()
    // V0.3.5 B-4: prime the DSL favorites list at app start.
    void fetchDslFavorites()
  }, [fetchConnections, fetchFolders, fetchDslFavorites])

  useEffect(() => {
    if (error) message.error(error)
  }, [error, message])

  useEffect(() => {
    if (folderError) message.error(folderError)
  }, [folderError, message])

  const openCreate = (): void => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (conn: EsConnection): void => {
    setEditing(conn)
    setFormOpen(true)
  }

  const closeForm = (): void => {
    setFormOpen(false)
    setEditing(null)
    setFormTestError(null)
    setFormTestResult(null)
  }

  const handleSubmit = async (
    values: ConnectionFormValues
  ): Promise<void> => {
    setSubmitting(true)
    const ok = editing
      ? await updateConnection(values)
      : await createConnection(values)
    setSubmitting(false)
    if (ok) {
      message.success(editing ? '已更新连接' : '已保存连接')
      closeForm()
    }
  }

  const handleTest = useCallback(
    async (values: ConnectionFormValues): Promise<void> => {
      setFormTesting(true)
      setFormTestError(null)
      setFormTestResult(null)
      const outcome = await testConnection(values)
      setFormTesting(false)
      if (outcome.ok) {
        setFormTestResult(outcome.result)
        message.success('连接成功')
      } else {
        setFormTestError(outcome.error)
      }
    },
    [testConnection]
  )

  const handleRowTest = useCallback(
    async (conn: EsConnection): Promise<void> => {
      setTestingId(conn.id)
      const outcome = await testConnection({
        id: conn.id,
        name: conn.name,
        url: conn.url,
        authType: conn.authType,
        username: conn.username,
        password: conn.password
      })
      setTestingId(null)
      if (outcome.ok) {
        message.success(
          `连接成功 · 集群 ${outcome.result.clusterName ?? '未知'} · ${outcome.result.health ?? 'unknown'}`
        )
      } else {
        message.error(outcome.error)
      }
    },
    [testConnection]
  )

  const handleDelete = useCallback(
    (conn: EsConnection): void => {
      modal.confirm({
        title: '确定删除该连接？',
        content: `删除后无法恢复：${conn.name}`,
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          const ok = await removeConnection(conn.id)
          if (ok) {
            if (activeId === conn.id) clearWorkspace()
            message.success('已删除连接')
          }
        }
      })
    },
    [removeConnection, activeId, clearWorkspace]
  )

  const handleActivate = useCallback(
    (conn: EsConnection) => {
      setActive(conn.id)
    },
    [setActive]
  )

  const openCreateFolder = (): void => {
    setEditingFolder(null)
    setFolderParentId(null)
    setFolderModalOpen(true)
  }

  // V0.3.9 E-4: open the modal pre-bound to a parent so the
  // created folder becomes a child of `parent`.
  const openCreateSubfolder = (parent: ConnectionFolder): void => {
    setEditingFolder(null)
    setFolderParentId(parent.id)
    setFolderModalOpen(true)
  }

  const openEditFolder = (folder: ConnectionFolder): void => {
    setEditingFolder(folder)
    setFolderParentId(null)
    setFolderModalOpen(true)
  }

  const closeFolderModal = (): void => {
    setFolderModalOpen(false)
    setEditingFolder(null)
    setFolderParentId(null)
  }

  const handleFolderSubmit = async (
    values: ConnectionFolderFormValues
  ): Promise<void> => {
    const payload: ConnectionFolderFormValues = editingFolder
      ? values
      : { ...values, parentId: folderParentId ?? null }
    const ok = editingFolder
      ? await updateFolder(payload)
      : await createFolder(payload)
    if (ok) {
      message.success(editingFolder ? '已更新目录' : '已新建目录')
      closeFolderModal()
    }
  }

  // V0.3.9 E-3: drag-and-drop and the row menu both arrive here.
  // We close over `activeId` so we can decide whether to clear the
  // workspace — moving the active connection to a different folder
  // keeps the workspace as-is (folder changes don't affect ES
  // session state), so no clearing is needed.
  const handleMoveToFolder = useCallback(
    async (conn: EsConnection, folderId: string | null): Promise<void> => {
      const ok = await moveConnectionToFolder(conn.id, folderId)
      if (ok) {
        message.success(`已将 "${conn.name}" 移动到目录`)
      } else {
        message.error('移动连接失败')
      }
    },
    [moveConnectionToFolder]
  )

  const handleDeleteFolder = useCallback(
    (folder: ConnectionFolder): void => {
      modal.confirm({
        title: '确定删除该目录？',
        content: `删除后，目录内的连接会移动到“未分组”：${folder.name}`,
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          const ok = await removeFolder(folder.id)
          if (ok) {
            if (activeId) {
              const stillExists = connections.some(
                (c) => c.id === activeId && c.folderId !== folder.id
              )
              if (!stillExists) clearWorkspace()
            }
            message.success('已删除目录')
          }
        }
      })
    },
    [removeFolder, activeId, connections, clearWorkspace]
  )

  return (
    <Layout style={{ height: '100%', overflow: 'hidden' }}>
      <AppHeader />
      <Layout style={{ height: '100%', overflow: 'hidden' }}>
        <Sider
          width={260}
          theme={isDark ? 'dark' : 'light'}
          style={{
            borderRight: '1px solid var(--ant-color-border-secondary)',
            height: '100%',
            overflow: 'hidden'
          }}
        >
          <AppSidebar
            data={connections}
            folders={folders}
            loading={loading}
            activeId={activeId}
            testingId={testingId}
            onActivate={handleActivate}
            onCreate={openCreate}
            onEdit={openEdit}
            onDelete={handleDelete}
            onTest={handleRowTest}
            onCreateFolder={openCreateFolder}
            onCreateSubfolder={openCreateSubfolder}
            onEditFolder={openEditFolder}
            onDeleteFolder={handleDeleteFolder}
            onMoveToFolder={handleMoveToFolder}
          />
        </Sider>
        <Content
          style={{
            padding: 0,
            display: 'flex',
            overflow: 'hidden',
            minWidth: 0,
            minHeight: 0
          }}
        >
          <WorkspacePage />
        </Content>
      </Layout>
      <Footer
        style={{
          textAlign: 'center',
          padding: '8px 16px',
          background: 'var(--ant-color-bg-layout)',
          flex: '0 0 auto'
        }}
      >
        <Space size="small">
          <Text type="secondary">SearchDBPad</Text>
          <Tag color="blue">Phase 10 · Packaging</Tag>
          {lastTestResult && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              最近测试：{lastTestResult.clusterName ?? '未知'} ·{' '}
              {lastTestResult.version ?? '未知版本'} · {lastTestResult.health}
            </Text>
          )}
        </Space>
      </Footer>

      <ConnectionForm
        open={formOpen}
        initial={editing}
        folders={folders}
        submitting={submitting}
        testing={formTesting}
        testResult={formTestResult}
        testError={formTestError}
        onCancel={closeForm}
        onSubmit={handleSubmit}
        onTest={handleTest}
      />

      <ConnectionFolderModal
        open={folderModalOpen}
        initial={editingFolder}
        parentId={editingFolder ? undefined : folderParentId}
        onCancel={closeFolderModal}
        onSubmit={handleFolderSubmit}
      />
    </Layout>
  )
}

export default App
