/**
 * Resource catalog with capability-gated index operations.
 *
 * Displays the engine-neutral resource:list result. Index-specific metrics
 * remain optional adapter metadata and do not apply to collections or cores.
 * Columns:
 *   - 索引名
 *   - 健康状态
 *   - 状态
 *   - 文档数
 *   - 删除文档数
 *   - 存储大小
 *   - 主分片
 *   - 副本
 *
 * Search is purely a client-side filter on the already-fetched list
 * (no extra ES round-trips). Clicking a row invokes `onSelect`; the
 * parent (WorkspacePage) is responsible for switching to the index
 * detail view.
 *
 * Phase 13 (version update plan):
 *   - The search / refresh / count row is rendered in a fixed header
 *     strip so it stays visible while the table scrolls.
 *   - The "新建索引" button opens the CreateIndexModal.
 *   - Per-row actions include a delete confirmation popover.
 */

import { useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  DeleteOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { SearchResourceInfo } from '@shared/searchEngine'
import CreateIndexModal from './CreateIndexModal'

const { Text } = Typography

function healthColor(
  status: 'green' | 'yellow' | 'red' | string
): string {
  if (status === 'green') return 'success'
  if (status === 'yellow') return 'warning'
  if (status === 'red') return 'error'
  return 'default'
}

function statusColor(status: 'open' | 'close' | string): string {
  if (status === 'open') return 'blue'
  if (status === 'close') return 'default'
  return 'default'
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—'
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatNumber(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US')
}

function indexMetric(resource: SearchResourceInfo, key: string): number | undefined {
  if (resource.kind !== 'index') return undefined
  const value = resource.metadata?.[key]
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

const RESOURCE_KIND_LABELS: Record<SearchResourceInfo['kind'], string> = {
  index: '索引',
  collection: 'Collection',
  core: 'Core',
  resource: '资源'
}

interface Props {
  onSelect: (indexName: string) => void
}

export default function IndexList({ onSelect }: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const indices = useWorkspaceStore((s) => s.indices)
  const loading = useWorkspaceStore((s) => s.indicesLoading)
  const error = useWorkspaceStore((s) => s.indicesError)
  const totalCount = useWorkspaceStore((s) => s.indexCount)
  const fetchIndices = useWorkspaceStore((s) => s.fetchIndices)
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const capabilities = useWorkspaceStore((s) => s.capabilities)
  const deleteIndex = useWorkspaceStore((s) => s.deleteIndex)
  // V0.3.1 A-1: per-row close / open lifecycle actions. Each holds
  // its own loading flag so the other buttons on the same row keep
  // responding while one operation is in flight.
  const closeIndex = useWorkspaceStore((s) => s.closeIndex)
  const openIndex = useWorkspaceStore((s) => s.openIndex)
  const selectIndex = useWorkspaceStore((s) => s.selectIndex)
  // V0.3.10 F-3 / F-4: jump-to-import variant. Used by the
  // create-and-import flow so the workspace selects the new
  // index AND lands on its "导入" tab with the modal-collected
  // draft pre-filled in ImportPanel.
  const selectIndexWithTab = useWorkspaceStore(
    (s) => s.selectIndexWithTab
  )

  const [keyword, setKeyword] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [deletingName, setDeletingName] = useState<string | null>(null)
  const [togglingName, setTogglingName] = useState<string | null>(null)

  // Generic collections and cores retain their own model; only declared
  // index capabilities expose Elasticsearch-style metrics and controls.
  const canManageIndexes = capabilities?.indexManagement === true
  const canOpenCloseIndexes = capabilities?.openCloseIndex === true
  const showIndexMetrics = capabilities?.indices === true

  const filtered = useMemo<SearchResourceInfo[]>(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return indices
    return indices.filter((resource) => resource.name.toLowerCase().includes(q))
  }, [indices, keyword])

  const indexMetricColumns: ColumnsType<SearchResourceInfo> = showIndexMetrics ? [
    {
      title: '删除文档数',
      key: 'docsDeleted',
      width: 110,
      align: 'right',
      sorter: (a, b) => (indexMetric(a, 'docsDeleted') ?? -1) - (indexMetric(b, 'docsDeleted') ?? -1),
      render: (_v: unknown, resource) => formatNumber(indexMetric(resource, 'docsDeleted'))
    },
    {
      title: '存储大小',
      key: 'storeSize',
      width: 120,
      align: 'right',
      sorter: (a, b) => (indexMetric(a, 'storeSize') ?? -1) - (indexMetric(b, 'storeSize') ?? -1),
      render: (_v: unknown, resource) => formatBytes(indexMetric(resource, 'storeSize'))
    },
    {
      title: '主分片',
      key: 'pri',
      width: 80,
      align: 'right',
      render: (_v: unknown, resource) => formatNumber(indexMetric(resource, 'pri'))
    },
    {
      title: '副本',
      key: 'rep',
      width: 80,
      align: 'right',
      render: (_v: unknown, resource) => formatNumber(indexMetric(resource, 'rep'))
    }
  ] : []

  const columns: ColumnsType<SearchResourceInfo> = [
    {
      title: '资源名',
      dataIndex: 'name',
      key: 'name',
      width: 240,
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft">
          <Text strong>{v}</Text>
        </Tooltip>
      )
    },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 110,
      render: (kind: SearchResourceInfo['kind']) => RESOURCE_KIND_LABELS[kind]
    },
    {
      title: '健康',
      dataIndex: 'health',
      key: 'health',
      width: 90,
      render: (v?: string) => v ? <Tag color={healthColor(v)}>{v}</Tag> : '—'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (v?: string) => v ? <Tag color={statusColor(v)}>{v}</Tag> : '—'
    },
    {
      title: '文档数',
      dataIndex: 'documentCount',
      key: 'documentCount',
      width: 110,
      align: 'right',
      sorter: (a, b) => (a.documentCount ?? -1) - (b.documentCount ?? -1),
      render: (v?: number) => formatNumber(v)
    },
    ...indexMetricColumns,
    ...(canManageIndexes || canOpenCloseIndexes ? [{
      title: '操作',
      key: 'actions',
      width: canManageIndexes && canOpenCloseIndexes ? 200 : 96,
      fixed: 'right' as const,
      render: (_v: unknown, record: SearchResourceInfo) => {
        if (record.kind !== 'index') return null
        const isOpen = record.status === 'open'
        // V0.3.1 A-1: close is destructive-with-side-effects (the
        // index stops accepting reads / writes until reopened), so
        // we wrap it in a Popconfirm. Open is a low-risk restore
        // and doesn't need one.
        return (
          <Space size={4} onClick={(e) => e.stopPropagation()}>
            {canOpenCloseIndexes && (isOpen ? (
              <Popconfirm
                title={`确定关闭索引 "${record.name}" ？`}
                description="关闭后索引将无法读写，重新打开后才能继续使用。"
                okText="关闭"
                cancelText="取消"
                onConfirm={async (e) => {
                  e?.stopPropagation()
                  if (!activeConnectionId) return
                  setTogglingName(record.name)
                  try {
                    const res = await closeIndex({
                      connectionId: activeConnectionId,
                      index: record.name
                    })
                    if (res?.success) {
                      message.success(`已关闭索引 "${record.name}"`)
                    } else if (res) {
                      message.error(
                        `关闭索引失败：${res.error?.message ?? '未知错误'}`
                      )
                    }
                  } finally {
                    setTogglingName(null)
                  }
                }}
                onCancel={(e) => e?.stopPropagation()}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<EyeInvisibleOutlined />}
                  loading={togglingName === record.name}
                  onClick={(e) => e.stopPropagation()}
                >
                  关闭
                </Button>
              </Popconfirm>
            ) : (
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                loading={togglingName === record.name}
                onClick={async (e) => {
                  e.stopPropagation()
                  if (!activeConnectionId) return
                  setTogglingName(record.name)
                  try {
                    const res = await openIndex({
                      connectionId: activeConnectionId,
                      index: record.name
                    })
                    if (res?.success) {
                      message.success(`已打开索引 "${record.name}"`)
                    } else if (res) {
                      message.error(
                        `打开索引失败：${res.error?.message ?? '未知错误'}`
                      )
                    }
                  } finally {
                    setTogglingName(null)
                  }
                }}
              >
                打开
              </Button>
            ))}
            {canManageIndexes && <Popconfirm
              title={`确定删除索引 "${record.name}" ？`}
              description="删除操作不可恢复，索引数据将永久丢失。"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={async (e) => {
                e?.stopPropagation()
                if (!activeConnectionId) return
                setDeletingName(record.name)
                try {
                  const res = await deleteIndex({
                    connectionId: activeConnectionId,
                    index: record.name
                  })
                  if (res?.success) {
                    message.success(`已删除索引 "${record.name}"`)
                  } else if (res) {
                    message.error(
                      `删除索引失败：${res.error?.message ?? '未知错误'}`
                    )
                  }
                } finally {
                  setDeletingName(null)
                }
              }}
              onCancel={(e) => e?.stopPropagation()}
            >
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                loading={deletingName === record.name}
                onClick={(e) => e.stopPropagation()}
              >
                删除
              </Button>
            </Popconfirm>}
          </Space>
        )
      }
    }] : [])
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--ant-color-bg-container)',
        borderRadius: 0,
        border: 0,
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          flex: '0 0 auto',
          padding: '12px 16px',
          borderBottom: '1px solid var(--ant-color-border-secondary)',
          background: 'var(--ant-color-bg-layout)'
        }}
      >
        <Space size="middle" wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="按资源名搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 260 }}
          />
          {canManageIndexes ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
            >
              新建索引
            </Button>
          ) : null}
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              if (activeConnectionId) void fetchIndices(activeConnectionId)
            }}
            loading={loading}
          >
            刷新
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {keyword
              ? `匹配 ${filtered.length} / ${totalCount}`
              : `共 ${totalCount} 个资源`}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            · 点击行查看详情
          </Text>
        </Space>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '0 8px' }}>
        {error ? (
          <div style={{ padding: 16 }}>
            <Text type="danger">无法加载资源列表：{error}</Text>
          </div>
        ) : (
          <Table<SearchResourceInfo>
            rowKey="name"
            columns={columns}
            dataSource={filtered}
            loading={loading}
            size="middle"
            scroll={{ x: 'max-content' }}
            onRow={(record) => ({
              onClick: () => onSelect(record.name),
              style: { cursor: 'pointer' }
            })}
            pagination={{
              showSizeChanger: true,
              defaultPageSize: 20,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (t) => `共 ${t} 条`
            }}
          />
        )}
      </div>

      <CreateIndexModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(name, intent) => {
          // V0.3.10 F-3: the modal's 导入数据 button lands on the
          // new index's 导入 tab; 完成 lands on the default
          // 文档 tab. Both paths go through `selectIndexWithTab`
          // so the panel's intent is one-shot consumed.
          if (intent?.tab === 'import') {
            setCreateOpen(false)
            selectIndexWithTab(name, 'import')
          } else if (intent?.tab === 'documents') {
            setCreateOpen(false)
            selectIndexWithTab(name, 'documents')
          } else {
            // Defensive fallback (no intent, e.g. older callers).
            setCreateOpen(false)
            selectIndex(name)
          }
        }}
      />
    </div>
  )
}
