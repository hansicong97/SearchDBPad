/**
 * Cluster info card (phase 3).
 *
 * Compact summary of the active connection's cluster:
 *   - cluster name + version
 *   - health status (color-coded tag)
 *   - node count
 *   - index count
 *
 * Pulls state from the workspace store. Loads on mount of the parent
 * workspace page; the parent owns the "refresh" trigger.
 */

import { Skeleton, Space, Tag, Typography } from 'antd'
import { useWorkspaceStore } from '../stores/workspace.store'

const { Text, Title } = Typography

function healthColor(
  status: 'green' | 'yellow' | 'red' | 'unknown' | string | undefined
): string {
  switch (status) {
    case 'green':
      return 'success'
    case 'yellow':
      return 'warning'
    case 'red':
      return 'error'
    default:
      return 'default'
  }
}

function healthLabel(
  status: 'green' | 'yellow' | 'red' | 'unknown' | string | undefined
): string {
  switch (status) {
    case 'green':
      return 'green 健康'
    case 'yellow':
      return 'yellow 警告'
    case 'red':
      return 'red 异常'
    default:
      return 'unknown'
  }
}

export default function ClusterInfoCard(): JSX.Element {
  const info = useWorkspaceStore((s) => s.clusterInfo)
  const health = useWorkspaceStore((s) => s.clusterHealth)
  const loading = useWorkspaceStore((s) => s.clusterLoading)
  const error = useWorkspaceStore((s) => s.clusterError)
  const indexCount = useWorkspaceStore((s) => s.indexCount)

  if (loading && !info && !health) {
    return <Skeleton active paragraph={{ rows: 2 }} />
  }

  if (error && !info && !health) {
    return (
      <Text type="danger">无法加载集群信息：{error}</Text>
    )
  }

  return (
    <Space size="large" wrap>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          集群名
        </Text>
        <div>
          <Title level={5} style={{ margin: 0 }}>
            {info?.clusterName || '未知'}
          </Title>
        </div>
      </div>

      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          ES 版本
        </Text>
        <div>
          <Space size={4}>
            <Text strong>{info?.version || '未知'}</Text>
            {info?.distribution && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                · {info.distribution}
              </Text>
            )}
          </Space>
        </div>
      </div>

      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          健康状态
        </Text>
        <div>
          <Tag color={healthColor(health?.status)}>
            {healthLabel(health?.status)}
          </Tag>
        </div>
      </div>

      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          节点数量
        </Text>
        <div>
          <Text strong>{health?.nodeCount ?? 0}</Text>
        </div>
      </div>

      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          索引数量
        </Text>
        <div>
          <Text strong>{indexCount}</Text>
        </div>
      </div>
    </Space>
  )
}
