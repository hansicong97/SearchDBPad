/**
 * Document browse panel (phase 5 + 7).
 *
 * Tab content for the 文档 entry in `IndexDetailPanel`. Shows a paginated
 * table of documents in the currently-selected index, defaults to
 * `match_all` with 20 rows per page, and supports refreshing, paging,
 * and changing the page size.
 *
 * Phase 7 adds per-row 编辑 / 删除 actions and a 新建文档 button. The
 * editor modal is owned by this panel because it owns the row context
 * (which index + which connection) — the modal itself is a dumb form
 * that talks to the workspace store.
 *
 * State lives in `useWorkspaceStore` so switching the active index clears
 * the result set and avoids leaking data from the previous selection.
 */

import { useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Empty,
  Skeleton,
  Space,
  Table,
  Tooltip,
  Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useConnectionStore } from '../stores/connection.store'
import DocumentEditorModal, {
  type DocumentEditorMode
} from './DocumentEditorModal'
import type { DocumentHit } from '@shared/ipc'

const { Text } = Typography

interface Props {
  /** When true, auto-load the first page on mount. Set false if the
   *  parent has already kicked off the fetch (e.g. on index select). */
  autoLoad?: boolean
}

/** Render a `_source` document as a pretty-printed JSON block, with a
 *  fixed max height and internal scrolling. Avoids row-height blow-up
 *  for documents with many fields. */
function SourceCell({ value }: { value: Record<string, unknown> | null }): JSX.Element {
  if (value === null) {
    return <Text type="secondary">(无文档字段)</Text>
  }
  const pretty = (() => {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  })()
  return (
    <pre
      style={{
        background: 'var(--ant-color-bg-layout)',
        border: '1px solid var(--ant-color-border-secondary)',
        borderRadius: 4,
        padding: 8,
        margin: 0,
        maxHeight: 160,
        overflow: 'auto',
        fontSize: 12,
        lineHeight: 1.5,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        whiteSpace: 'pre'
      }}
    >
      {pretty}
    </pre>
  )
}

export default function DocumentPanel({ autoLoad = true }: Props): JSX.Element {
  const { modal, message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const selectedIndex = useWorkspaceStore((s) => s.selectedIndex)
  const capabilities = useWorkspaceStore((s) => s.capabilities)
  const engineType = useConnectionStore((s) => s.connections.find((c) => c.id === activeConnectionId)?.engineType ?? 'elasticsearch')

  const hits = useWorkspaceStore((s) => s.documentHits)
  const total = useWorkspaceStore((s) => s.documentTotal)
  const totalRelation = useWorkspaceStore((s) => s.documentTotalRelation)
  const took = useWorkspaceStore((s) => s.documentTook)
  const page = useWorkspaceStore((s) => s.documentPage)
  const pageSize = useWorkspaceStore((s) => s.documentPageSize)
  const loading = useWorkspaceStore((s) => s.documentLoading)
  const error = useWorkspaceStore((s) => s.documentError)

  const setDocumentPage = useWorkspaceStore((s) => s.setDocumentPage)
  const setDocumentPageSize = useWorkspaceStore((s) => s.setDocumentPageSize)
  const refreshDocumentPage = useWorkspaceStore((s) => s.refreshDocumentPage)
  const deleteDocument = useWorkspaceStore((s) => s.deleteDocument)

  // Editor modal state. We own it here, not in the store, because the
  // editing target is per-row UI state — no other component needs it.
  const [editorOpen, setEditorOpen] = useState<boolean>(false)
  const [editorMode, setEditorMode] = useState<DocumentEditorMode>('create')
  const [editingHit, setEditingHit] = useState<DocumentHit | null>(null)

  useEffect(() => {
    setEditorOpen(false)
    setEditingHit(null)
  }, [activeConnectionId, selectedIndex])

  // Auto-load the first page when the selected index changes. The store
  // also kicks off this fetch in `selectIndex`, so this guards the case
  // where the panel mounts directly (e.g. tab switch) without going
  // through selectIndex.
  useEffect(() => {
    if (!autoLoad) return
    if (!activeConnectionId || !selectedIndex) return
    if (hits.length > 0 || loading) return
    void refreshDocumentPage()
    // We intentionally only re-run when the selected index changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId, selectedIndex, autoLoad])

  const handleRefresh = (): void => {
    void refreshDocumentPage()
  }

  const handlePageChange = (next: number, nextSize: number): void => {
    if (nextSize !== pageSize) {
      // AntD fires onChange with both the new page and the new size when
      // the size selector changes. Routing both through setDocumentPageSize
      // keeps the page at 1 (see the action implementation).
      setDocumentPageSize(nextSize)
      return
    }
    setDocumentPage(next)
  }

  const handleCreate = (): void => {
    setEditorMode('create')
    setEditingHit(null)
    setEditorOpen(true)
  }

  const handleEdit = (hit: DocumentHit): void => {
    if (!hit.id) return
    setEditorMode('edit')
    setEditingHit(hit)
    setEditorOpen(true)
  }

  const handleEditorClose = (): void => {
    setEditorOpen(false)
    setEditingHit(null)
  }

  const handleDelete = (hit: DocumentHit): void => {
    if (!activeConnectionId || !selectedIndex || !hit.id) return
    modal.confirm({
      title: '确定删除该文档？',
      content: (
        <div>
          <div>ID: <Text code>{hit.id}</Text></div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            删除后无法通过当前接口恢复，请确认。
          </Text>
        </div>
      ),
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      maskClosable: false,
      onOk: async () => {
        const res = await deleteDocument({
          connectionId: activeConnectionId,
          index: selectedIndex,
          id: hit.id ?? ''
        })
        if (res === null) return
        if (res.success && res.data) {
          if (res.data.result === 'not_found') {
            message.warning(`文档已不存在 ID=${hit.id}`)
          } else {
            message.success(`已删除文档 ID=${hit.id}`)
          }
        } else {
          message.error(`删除失败：${res.error?.message ?? '未知错误'}`)
        }
      }
    })
  }

  const columns: ColumnsType<DocumentHit> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: '_id',
      width: 220,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft">
          <Text strong style={{ wordBreak: 'break-all' }}>
            {v}
          </Text>
        </Tooltip>
      )
    },
    {
      title: '文档字段',
      dataIndex: 'fields',
      key: 'fields',
      render: (_v: unknown, record: DocumentHit) => <SourceCell value={record.fields} />
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_v: unknown, record: DocumentHit) => (
        <Space size={4}>
          <Tooltip title="编辑文档字段">
            <Button
              size="small"
              type="link"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
              disabled={loading || !capabilities?.documentWrite || !record.id}
            >
              编辑
            </Button>
          </Tooltip>
          <Tooltip title="删除文档">
            <Button
              size="small"
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)}
              disabled={loading || !capabilities?.documentWrite || !record.id}
            >
              删除
            </Button>
          </Tooltip>
        </Space>
      )
    }
  ]

  // ES caps `total` at 10000 by default and reports `relation: 'gte'`.
  // Surface that in the pagination footer so users aren't misled.
  const totalLabel =
    totalRelation === 'gte' ? `≥ ${total.toLocaleString('en-US')}` : total.toLocaleString('en-US')

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        padding: 12
      }}
    >
      <Space style={{ marginBottom: 12, flex: '0 0 auto' }} size="middle">
        <Button
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={loading}
          size="small"
        >
          刷新
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleCreate}
          disabled={!activeConnectionId || !selectedIndex || loading || !capabilities?.documentWrite}
          size="small"
        >
          新建文档
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {totalLabel} 条 · took {took} ms · 每页 {pageSize}
        </Text>
        {!autoLoad && hits.length === 0 && !loading && !error ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            · 默认查询 {engineType === 'solr' ? 'q=*:*' : 'match_all'}
          </Text>
        ) : null}
      </Space>

      {error ? (
        <Text type="danger">查询失败：{error}</Text>
      ) : loading && hits.length === 0 ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
          <Table<DocumentHit>
            rowKey={(record, index) => record.id ?? `hit-${index}`}
            columns={columns}
            dataSource={hits}
            loading={loading}
            size="small"
            scroll={{ x: 'max-content' }}
            locale={{
              emptyText: <Empty description="该索引当前没有匹配的文档" />
            }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (t) =>
                totalRelation === 'gte' ? `≥ ${t.toLocaleString('en-US')} 条` : `共 ${t} 条`,
              onChange: handlePageChange
            }}
          />
        </div>
      )}

      <DocumentEditorModal
        open={editorOpen}
        mode={editorMode}
        indexName={selectedIndex ?? ''}
        hit={editingHit}
        onClose={handleEditorClose}
      />
    </div>
  )
}
