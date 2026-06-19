/**
 * Left sidebar (phase 3 layout).
 *
 * Shows the connection list as a vertical list. The active connection is
 * highlighted; clicking a row enters its workspace. Per-row actions
 * (test / edit / delete) are tucked into a dropdown so the sidebar stays
 * compact.
 *
 * The "+ 新建连接" button at the top opens the existing ConnectionForm
 * modal through a callback — the modal lives in App.tsx so the rest of the
 * layout can react to its open/close state if needed.
 */

import {
  Badge,
  Button,
  Dropdown,
  Empty,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { MenuProps } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PlusOutlined
} from '@ant-design/icons'
import type { EsConnection } from '@shared/ipc'

const { Text } = Typography

interface Props {
  data: EsConnection[]
  loading: boolean
  activeId: string | null
  testingId: string | null
  onActivate: (conn: EsConnection) => void
  onCreate: () => void
  onEdit: (conn: EsConnection) => void
  onDelete: (conn: EsConnection) => void
  onTest: (conn: EsConnection) => void
}

export default function AppSidebar({
  data,
  loading,
  activeId,
  testingId,
  onActivate,
  onCreate,
  onEdit,
  onDelete,
  onTest
}: Props): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: 12
      }}
    >
      <Space style={{ marginBottom: 12 }} size="small">
        <Text strong>连接</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {data.length}
        </Text>
      </Space>

      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={onCreate}
        block
        style={{ marginBottom: 12 }}
      >
        新建连接
      </Button>

      <div style={{ flex: 1, overflowY: 'auto', marginRight: -8, paddingRight: 8 }}>
        {loading && data.length === 0 ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : data.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text type="secondary" style={{ fontSize: 12 }}>
                还没有保存任何连接
              </Text>
            }
          />
        ) : (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {data.map((conn) => {
              const active = conn.id === activeId
              return (
                <div
                  key={conn.id}
                  onClick={() => onActivate(conn)}
                  style={{
                    cursor: 'pointer',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: active
                      ? '1px solid #1677ff'
                      : '1px solid transparent',
                    background: active ? '#e6f4ff' : 'transparent',
                    transition: 'background 0.15s'
                  }}
                >
                  <Space style={{ width: '100%' }} size={4} align="start">
                    <Badge
                      status={
                        conn.authType === 'basic' ? 'processing' : 'default'
                      }
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        strong
                        style={{
                          display: 'block',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {conn.name}
                      </Text>
                      <Tooltip title={conn.url} placement="topLeft">
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 12,
                            display: 'block',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {conn.url}
                        </Text>
                      </Tooltip>
                    </div>
                    <Dropdown
                      menu={{
                        items: buildMenuItems({
                          testing: testingId === conn.id,
                          onTest: () => onTest(conn),
                          onEdit: () => onEdit(conn),
                          onDelete: () => onDelete(conn)
                        })
                      }}
                      trigger={['click']}
                      placement="bottomRight"
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<MoreOutlined />}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="更多操作"
                      />
                    </Dropdown>
                  </Space>
                  {active && (
                    <Tag
                      color="blue"
                      style={{ marginTop: 6, marginLeft: 18, fontSize: 12 }}
                    >
                      当前工作台
                    </Tag>
                  )}
                </div>
              )
            })}
          </Space>
        )}
      </div>
    </div>
  )
}

function buildMenuItems(handlers: {
  testing: boolean
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
}): NonNullable<MenuProps['items']> {
  return [
    {
      key: 'test',
      label: testingLabel(handlers.testing),
      icon: <PlayCircleOutlined />,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation()
        handlers.onTest()
      }
    },
    {
      key: 'edit',
      label: '编辑',
      icon: <EditOutlined />,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation()
        handlers.onEdit()
      }
    },
    { type: 'divider' },
    {
      key: 'delete',
      label: '删除',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation()
        handlers.onDelete()
      }
    }
  ]
}

function testingLabel(testing: boolean): JSX.Element {
  if (testing) {
    return (
      <Space size={4}>
        <span>测试中</span>
      </Space>
    )
  }
  return <span>测试连接</span>
}
