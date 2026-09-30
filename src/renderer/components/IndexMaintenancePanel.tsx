/**
 * 索引维护面板（V0.3.12）。
 *
 * 索引详情「维护」tab：Refresh / Flush / Force Merge / Clear Cache。
 * 每个操作先确认，再经 preload IPC 调用主进程；renderer 不直接访问网络。
 * closed 索引禁用全部按钮。Force Merge 可选 max_num_segments，执行期间
 * 按钮显示 loading，不阻塞其余界面。
 */

import { useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  InputNumber,
  Space,
  Typography
} from 'antd'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { IndexMaintenanceShards } from '@shared/ipc'

const { Text } = Typography

interface Props {
  indexName: string
}

type ActionKey = 'refresh' | 'flush' | 'forceMerge' | 'clearCache'

interface ActionResult {
  label: string
  shards?: IndexMaintenanceShards
}

const ACTION_LABEL: Record<ActionKey, string> = {
  refresh: 'Refresh',
  flush: 'Flush',
  forceMerge: 'Force Merge',
  clearCache: 'Clear Cache'
}

export default function IndexMaintenancePanel({
  indexName
}: Props): JSX.Element {
  const { message, modal } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const indices = useWorkspaceStore((s) => s.indices)
  const closed =
    indices.find((item) => item.index === indexName)?.status === 'close'

  const [acting, setActing] = useState<ActionKey | null>(null)
  const [maxNumSegments, setMaxNumSegments] = useState<number | null>(null)
  const [result, setResult] = useState<ActionResult | null>(null)

  const busy = acting !== null

  const run = async (action: ActionKey): Promise<void> => {
    if (!activeConnectionId || closed) return
    setActing(action)
    const max =
      action === 'forceMerge' &&
      typeof maxNumSegments === 'number' &&
      Number.isInteger(maxNumSegments) &&
      maxNumSegments > 0
        ? maxNumSegments
        : undefined
    const req = {
      connectionId: activeConnectionId,
      index: indexName,
      maxNumSegments: max
    }
    const res =
      action === 'refresh'
        ? await window.esApi.indices.refresh(req)
        : action === 'flush'
          ? await window.esApi.indices.flush(req)
          : action === 'forceMerge'
            ? await window.esApi.indices.forceMerge(req)
            : await window.esApi.indices.clearCache(req)
    setActing(null)
    if (!res.success || !res.data) {
      message.error(res.error?.message ?? `${ACTION_LABEL[action]} 失败`)
      return
    }
    setResult({
      label: ACTION_LABEL[action],
      shards: res.data.shards
    })
    message.success(`${ACTION_LABEL[action]} 已完成`)
  }

  const confirmAndRun = (action: ActionKey): void => {
    const label = ACTION_LABEL[action]
    const segmentsHint =
      action === 'forceMerge' &&
      typeof maxNumSegments === 'number' &&
      maxNumSegments > 0
        ? `将使用 max_num_segments = ${maxNumSegments}。`
        : action === 'forceMerge'
          ? '未指定 max_num_segments，由 Elasticsearch 自行决定。'
          : ''
    modal.confirm({
      title: `确认对「${indexName}」执行 ${label}？`,
      content:
        action === 'forceMerge' ? (
          <Space direction="vertical" size={4}>
            <Text>
              可能耗时较长，期间索引写入性能可能下降。
            </Text>
            {segmentsHint ? <Text type="secondary">{segmentsHint}</Text> : null}
          </Space>
        ) : (
          `将对索引「${indexName}」执行 ${label}。`
        ),
      okText: '执行',
      cancelText: '取消',
      onOk: () => {
        void run(action)
      }
    })
  }

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {closed ? (
          <Alert
            type="warning"
            showIcon
            message="索引已关闭，请先打开后再执行维护操作。"
          />
        ) : null}
        {result ? (
          <Alert
            type={result.shards && result.shards.failed > 0 ? 'warning' : 'success'}
            showIcon
            message={`${result.label} 完成`}
            description={
              result.shards
                ? `shards：total ${result.shards.total} / successful ${result.shards.successful} / failed ${result.shards.failed}`
                : '操作已完成，服务端未返回 shards 统计。'
            }
          />
        ) : null}
        <Space direction="vertical" size="small">
          <Space>
            <Button
              type="primary"
              disabled={closed || !activeConnectionId || (busy && acting !== 'refresh')}
              loading={acting === 'refresh'}
              onClick={() => confirmAndRun('refresh')}
            >
              Refresh
            </Button>
            <Text type="secondary">使最近写入对搜索可见</Text>
          </Space>
          <Space>
            <Button
              disabled={closed || !activeConnectionId || (busy && acting !== 'flush')}
              loading={acting === 'flush'}
              onClick={() => confirmAndRun('flush')}
            >
              Flush
            </Button>
            <Text type="secondary">将内存 buffer 持久化到磁盘</Text>
          </Space>
          <Space wrap>
            <Button
              disabled={
                closed || !activeConnectionId || (busy && acting !== 'forceMerge')
              }
              loading={acting === 'forceMerge'}
              onClick={() => confirmAndRun('forceMerge')}
            >
              Force Merge
            </Button>
            <InputNumber
              min={1}
              precision={0}
              placeholder="max_num_segments（可选）"
              value={maxNumSegments}
              disabled={closed || !activeConnectionId || busy}
              onChange={(value) =>
                setMaxNumSegments(typeof value === 'number' ? value : null)
              }
            />
            <Text type="secondary">合并 segments，留空则由 ES 决定</Text>
          </Space>
          <Space>
            <Button
              disabled={
                closed || !activeConnectionId || (busy && acting !== 'clearCache')
              }
              loading={acting === 'clearCache'}
              onClick={() => confirmAndRun('clearCache')}
            >
              Clear Cache
            </Button>
            <Text type="secondary">
              清除索引级 query / fielddata / request cache
            </Text>
          </Space>
        </Space>
      </Space>
    </div>
  )
}
