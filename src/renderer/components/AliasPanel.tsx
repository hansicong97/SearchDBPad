/**
 * Alias panel (V0.3.4 A-4).
 *
 * Per-index tab content. Lists aliases that point at the currently
 * selected index, supports adding a new alias and removing an
 * existing one (with a confirm popover for the destructive path).
 *
 * Aliases are connection-scoped in the store, but the Alias tab
 * filters down to the active index — a user looking at index
 * `logs-2025-06` doesn't want to see aliases that point at
 * `logs-2025-05`. The full connection-wide list lives behind the
 * modal in the workspace header (see WorkspacePage) for any
 * cross-index audit.
 */

import { useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Empty,
  Popconfirm,
  Skeleton,
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
  ReloadOutlined
} from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { EsAliasInfo } from '@shared/ipc'
import AliasEditorModal from './AliasEditorModal'

const { Text } = Typography

interface Props {
  indexName: string
}

export default function AliasPanel({ indexName }: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const aliases = useWorkspaceStore((s) => s.aliases)
  const loading = useWorkspaceStore((s) => s.aliasesLoading)
  const error = useWorkspaceStore((s) => s.aliasesError)
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const fetchAliases = useWorkspaceStore((s) => s.fetchAliases)
  const deleteAlias = useWorkspaceStore((s) => s.deleteAlias)

  const [createOpen, setCreateOpen] = useState(false)
  const [deletingAlias, setDeletingAlias] = useState<string | null>(null)

  const filtered = useMemo<EsAliasInfo[]>(
    () => aliases.filter((a) => a.index === indexName),
    [aliases, indexName]
  )

  const columns: ColumnsType<EsAliasInfo> = [
    {
      title: 'Alias',
      dataIndex: 'alias',
      key: 'alias',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft">
          <Text strong style={{ wordBreak: 'break-all' }}>
            {v}
          </Text>
        </Tooltip>
      )
    },
    {
      title: '指向索引',
      dataIndex: 'index',
      key: 'index',
      width: 200,
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft">
          <Tag color="blue">{v}</Tag>
        </Tooltip>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_v, record) => (
        <Popconfirm
          title={`确定删除 Alias "${record.alias}" ？`
            + (record.index === indexName
              ? ''
              : `（该 Alias 当前指向索引 "${record.index}"）`)}
          description="删除后该 Alias 将无法访问，指向的索引本身不受影响。"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={async () => {
            if (!activeConnectionId) return
            setDeletingAlias(record.alias)
            try {
              const res = await deleteAlias({
                connectionId: activeConnectionId,
                index: record.index,
                alias: record.alias
              })
              if (res?.success) {
                message.success(`已删除 Alias "${record.alias}"`)
              } else if (res) {
                message.error(
                  `删除 Alias 失败：${res.error?.message ?? '未知错误'}`
                )
              }
            } finally {
              setDeletingAlias(null)
            }
          }}
        >
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            loading={deletingAlias === record.alias}
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
        gap: 12
      }}
    >
      <Space size="middle" wrap>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateOpen(true)}
        >
          新增 Alias
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            if (activeConnectionId) void fetchAliases(activeConnectionId)
          }}
          loading={loading}
        >
          刷新
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          · 当前索引 {filtered.length} 个 Alias
        </Text>
      </Space>

      {error ? (
        <Text type="danger">无法加载 Alias 列表：{error}</Text>
      ) : loading && aliases.length === 0 ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : filtered.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            aliases.length === 0
              ? '该连接暂无 Alias，点击「新增 Alias」开始'
              : `索引 "${indexName}" 暂无 Alias`
          }
        />
      ) : (
        <Table<EsAliasInfo>
          rowKey="alias"
          columns={columns}
          dataSource={filtered}
          size="middle"
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      )}

      <AliasEditorModal
        open={createOpen}
        indexName={indexName}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}
