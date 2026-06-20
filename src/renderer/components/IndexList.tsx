/**
 * Index list (phase 3 + 4 + index ops in 13).
 *
 * Displays indices returned by `GET /_cat/indices?format=json&bytes=b`.
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
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { EsIndexInfo } from '@shared/ipc'
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

function formatBytes(bytes: number): string {
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

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('en-US')
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
  const deleteIndex = useWorkspaceStore((s) => s.deleteIndex)
  const selectIndex = useWorkspaceStore((s) => s.selectIndex)

  const [keyword, setKeyword] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [deletingName, setDeletingName] = useState<string | null>(null)

  const filtered = useMemo<EsIndexInfo[]>(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return indices
    return indices.filter((idx) => idx.index.toLowerCase().includes(q))
  }, [indices, keyword])

  const columns: ColumnsType<EsIndexInfo> = [
    {
      title: '索引名',
      dataIndex: 'index',
      key: 'index',
      width: 240,
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft">
          <Text strong>{v}</Text>
        </Tooltip>
      )
    },
    {
      title: '健康',
      dataIndex: 'health',
      key: 'health',
      width: 90,
      render: (v: string) => <Tag color={healthColor(v)}>{v}</Tag>
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag>
    },
    {
      title: '文档数',
      dataIndex: 'docsCount',
      key: 'docsCount',
      width: 110,
      align: 'right',
      sorter: (a, b) => a.docsCount - b.docsCount,
      render: (v: number) => formatNumber(v)
    },
    {
      title: '删除文档数',
      dataIndex: 'docsDeleted',
      key: 'docsDeleted',
      width: 110,
      align: 'right',
      sorter: (a, b) => a.docsDeleted - b.docsDeleted,
      render: (v: number) => formatNumber(v)
    },
    {
      title: '存储大小',
      dataIndex: 'storeSize',
      key: 'storeSize',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.storeSize - b.storeSize,
      render: (v: number) => formatBytes(v)
    },
    {
      title: '主分片',
      dataIndex: 'pri',
      key: 'pri',
      width: 80,
      align: 'right'
    },
    {
      title: '副本',
      dataIndex: 'rep',
      key: 'rep',
      width: 80,
      align: 'right'
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_v, record) => (
        <Popconfirm
          title={`确定删除索引 "${record.index}" ？`}
          description="删除操作不可恢复，索引数据将永久丢失。"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={async (e) => {
            e?.stopPropagation()
            if (!activeConnectionId) return
            setDeletingName(record.index)
            try {
              const res = await deleteIndex({
                connectionId: activeConnectionId,
                index: record.index
              })
              if (res) {
                message.success(`已删除索引 "${record.index}"`)
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
            loading={deletingName === record.index}
            onClick={(e) => e.stopPropagation()}
          >
            删除
          </Button>
        </Popconfirm>
      )
    }
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
            placeholder="按索引名搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 260 }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            新建索引
          </Button>
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
              : `共 ${totalCount} 个索引`}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            · 点击行查看详情
          </Text>
        </Space>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '0 8px' }}>
        {error ? (
          <div style={{ padding: 16 }}>
            <Text type="danger">无法加载索引列表：{error}</Text>
          </div>
        ) : (
          <Table<EsIndexInfo>
            rowKey="index"
            columns={columns}
            dataSource={filtered}
            loading={loading}
            size="middle"
            scroll={{ x: 'max-content' }}
            onRow={(record) => ({
              onClick: () => onSelect(record.index),
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
        onCreated={(name) => {
          selectIndex(name)
        }}
      />
    </div>
  )
}
