/**
 * Shard panel (V0.3.9 E-7).
 *
 * Tab content for the 分片 entry in `IndexDetailPanel`. Shows one row
 * per shard (primary + each replica) returned by
 * `GET /_cat/shards/{index}?format=json&bytes=b`, and exposes two
 * write actions per row:
 *
 *   - 迁移分片: `POST /_cluster/reroute` with a `move` command.
 *     Both nodes must be cluster members; ES returns 400 with a
 *     descriptive error otherwise, which the service layer
 *     surfaces verbatim.
 *   - 取消分配: `POST /_cluster/reroute` with a `cancel` command.
 *     Only meaningful when the shard is UNASSIGNED; ES rejects
 *     cancel on assigned shards with a 400.
 *
 * Both actions wrap in Popconfirm and clearly show what node the
 * shard is moving from / to so the user has the impact context the
 * plan calls out.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Empty,
  Input,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ReloadOutlined,
  SwapOutlined,
  StopOutlined
} from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { ShardInfo } from '@shared/ipc'

const { Text } = Typography

interface Props {
  indexName: string
}

function stateColor(state: string): string {
  if (state === 'STARTED') return 'success'
  if (state === 'RELOCATING') return 'processing'
  if (state === 'INITIALIZING') return 'processing'
  if (state === 'UNASSIGNED') return 'warning'
  return 'default'
}

export default function ShardPanel({ indexName }: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const shards = useWorkspaceStore((s) => s.shards)
  const shardsLoading = useWorkspaceStore((s) => s.shardsLoading)
  const shardsError = useWorkspaceStore((s) => s.shardsError)
  const fetchShards = useWorkspaceStore((s) => s.fetchShards)
  const relocateShard = useWorkspaceStore((s) => s.relocateShard)
  const cancelShardAllocation = useWorkspaceStore((s) => s.cancelShardAllocation)

  // Per-row pending flag so the two write ops on a given row don't
  // stomp each other when both fire concurrently.
  const [acting, setActing] = useState<string | null>(null)

  // Relocate dialog state — kept local to the panel because it's
  // a transient confirmation flow, not a long-lived selection.
  const [relocateShardKey, setRelocateShardKey] = useState<string | null>(null)
  const [toNode, setToNode] = useState<string>('')

  // Fetch on mount and whenever the index changes. The store's
  // race guard drops stale responses, so we can fire this
  // unconditionally here.
  useEffect(() => {
    if (!activeConnectionId) return
    void fetchShards(activeConnectionId, indexName)
  }, [activeConnectionId, indexName, fetchShards])

  // Build the node picker from the STARTED shards so the user can
  // only pick from names ES actually reports. Includes the empty
  // string for "no node assigned" cases (UNASSIGNED shards).
  const nodeOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of shards) {
      if (s.node) set.add(s.node)
    }
    return Array.from(set).sort().map((n) => ({ label: n, value: n }))
  }, [shards])

  const handleRelocate = async (s: ShardInfo): Promise<void> => {
    if (!activeConnectionId || !toNode.trim()) return
    setActing(`${s.shard}|${s.prirep}`)
    try {
      const res = await relocateShard({
        connectionId: activeConnectionId,
        index: indexName,
        shard: s.shard,
        fromNode: s.node,
        toNode: toNode.trim()
      })
      if (res?.success) {
        message.success(
          `分片 ${s.shard} (${s.prirep}) 已请求从 ${s.node} 迁至 ${toNode.trim()}`
        )
        setRelocateShardKey(null)
        setToNode('')
      } else if (res) {
        message.error(
          `迁移分片失败：${res.error?.message ?? '未知错误'}`
        )
      }
    } finally {
      setActing(null)
    }
  }

  const handleCancel = async (s: ShardInfo): Promise<void> => {
    if (!activeConnectionId) return
    setActing(`${s.shard}|${s.prirep}`)
    try {
      const res = await cancelShardAllocation({
        connectionId: activeConnectionId,
        index: indexName,
        shard: s.shard,
        node: s.node
      })
      if (res?.success) {
        message.success(`已取消分片 ${s.shard} (${s.prirep}) 的分配`)
      } else if (res) {
        message.error(
          `取消分配失败：${res.error?.message ?? '未知错误'}`
        )
      }
    } finally {
      setActing(null)
    }
  }

  const columns: ColumnsType<ShardInfo> = [
    {
      title: '分片',
      dataIndex: 'shard',
      key: 'shard',
      width: 80,
      align: 'right'
    },
    {
      title: '角色',
      dataIndex: 'prirep',
      key: 'prirep',
      width: 80,
      render: (v: string) => (
        <Tag color={v === 'p' ? 'blue' : 'default'}>
          {v === 'p' ? '主' : '副'}
        </Tag>
      )
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 130,
      render: (v: string) => <Tag color={stateColor(v)}>{v || '-'}</Tag>
    },
    {
      title: '节点',
      dataIndex: 'node',
      key: 'node',
      width: 160,
      ellipsis: true,
      render: (v: string) =>
        v ? (
          <Tooltip title={v} placement="topLeft">
            <Text style={{ fontFamily: 'monospace' }}>{v}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">-</Text>
        )
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      key: 'ip',
      width: 140,
      ellipsis: true,
      render: (v: string) =>
        v ? <Text style={{ fontFamily: 'monospace' }}>{v}</Text> : '-'
    },
    {
      title: '文档数',
      dataIndex: 'docs',
      key: 'docs',
      width: 100,
      align: 'right'
    },
    {
      title: '大小',
      dataIndex: 'store',
      key: 'store',
      width: 100,
      align: 'right'
    },
    {
      title: '未分配原因',
      dataIndex: 'unassignedReason',
      key: 'unassignedReason',
      width: 160,
      ellipsis: true,
      render: (v?: string) =>
        v ? (
          <Tooltip title={v} placement="topLeft">
            <Text type="warning">{v}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">-</Text>
        )
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: (_v, record) => {
        const rowKey = `${record.shard}|${record.prirep}`
        const isActing = acting === rowKey
        const canMove = record.state === 'STARTED' && !!record.node
        const canCancel = record.state === 'UNASSIGNED'
        return (
          <Space size={4} onClick={(e) => e.stopPropagation()}>
            <Popconfirm
              open={relocateShardKey === rowKey}
              title={`迁移分片 ${record.shard} (${record.prirep})`}
              description={
                <Space direction="vertical" size={6} style={{ width: 280 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    从 {record.node || '(无)'} 迁至：
                  </Text>
                  <Select
                    value={toNode || undefined}
                    onChange={setToNode}
                    placeholder="选择目标节点"
                    style={{ width: '100%' }}
                    options={nodeOptions.filter(
                      (o) => o.value !== record.node
                    )}
                    showSearch
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    写入操作：将触发副本复制与节点切换。
                  </Text>
                </Space>
              }
              okText="执行迁移"
              cancelText="取消"
              okButtonProps={{ disabled: !toNode.trim() }}
              onConfirm={() => void handleRelocate(record)}
              onCancel={() => {
                setRelocateShardKey(null)
                setToNode('')
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<SwapOutlined />}
                disabled={!canMove}
                loading={isActing}
                onClick={(e) => {
                  e.stopPropagation()
                  setToNode('')
                  setRelocateShardKey(rowKey)
                }}
              >
                迁移
              </Button>
            </Popconfirm>
            <Popconfirm
              title={`取消分片 ${record.shard} (${record.prirep}) 的分配`}
              description={
                <Space direction="vertical" size={4}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    节点：{record.node || '(未分配)'}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    写入操作：取消后该副本需要重新分配。
                  </Text>
                </Space>
              }
              okText="取消分配"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleCancel(record)}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<StopOutlined />}
                disabled={!canCancel}
                loading={isActing}
                onClick={(e) => e.stopPropagation()}
              >
                取消分配
              </Button>
            </Popconfirm>
          </Space>
        )
      }
    }
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        height: '100%'
      }}
    >
      <Space size="middle" wrap>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            if (activeConnectionId)
              void fetchShards(activeConnectionId, indexName)
          }}
          loading={shardsLoading}
        >
          刷新
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {shards.length} 个分片 · 目标节点必须来自上方列表
        </Text>
      </Space>

      {shardsError ? (
        <Alert
          type="error"
          showIcon
          message="获取分片列表失败"
          description={shardsError}
        />
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {shardsLoading && shards.length === 0 ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : shards.length === 0 ? (
          <Empty description="该索引暂无分片数据" />
        ) : (
          <Table<ShardInfo>
            rowKey={(r) => `${r.shard}|${r.prirep}`}
            columns={columns}
            dataSource={shards}
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        )}
      </div>
    </div>
  )
}