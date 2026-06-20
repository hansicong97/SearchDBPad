/**
 * Left sidebar (phase 3 + 15 UI update).
 *
 * Shows the connection list grouped by user-defined folders. The implicit
 * "未分组" bucket is rendered first and holds any connection whose
 * `folderId` is null/undefined (including legacy phase 2 entries).
 *
 * Per-row actions (test / edit / delete) are tucked into a dropdown so the
 * sidebar stays compact. Each folder header also has a `MoreOutlined`
 * dropdown with 重命名 / 删除 actions.
 *
 * The "+ 新建连接" / "+ 新建目录" buttons at the top open the existing
 * ConnectionForm / ConnectionFolderModal modals through callbacks — both
 * modals live in `App.tsx` so the rest of the layout can react to their
 * open / close state if needed.
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
  FolderAddOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PlusOutlined
} from '@ant-design/icons'
import type {
  ConnectionFolder,
  EsConnection
} from '@shared/ipc'

const { Text } = Typography

interface Props {
  data: EsConnection[]
  folders: ConnectionFolder[]
  loading: boolean
  activeId: string | null
  testingId: string | null
  onActivate: (conn: EsConnection) => void
  onCreate: () => void
  onEdit: (conn: EsConnection) => void
  onDelete: (conn: EsConnection) => void
  onTest: (conn: EsConnection) => void
  onCreateFolder: () => void
  onEditFolder: (folder: ConnectionFolder) => void
  onDeleteFolder: (folder: ConnectionFolder) => void
}

const UNGROUPED_TITLE = '未分组'

interface Group {
  /** `null` for the implicit "未分组" bucket; otherwise folder id. */
  folderId: string | null
  title: string
  connections: EsConnection[]
  /** Undefined for the implicit bucket (no rename/delete). */
  folder?: ConnectionFolder
}

export default function AppSidebar({
  data,
  folders,
  loading,
  activeId,
  testingId,
  onActivate,
  onCreate,
  onEdit,
  onDelete,
  onTest,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder
}: Props): JSX.Element {
  const ungrouped: EsConnection[] = []
  const byFolder = new Map<string, EsConnection[]>()
  for (const conn of data) {
    if (!conn.folderId) {
      ungrouped.push(conn)
    } else {
      const list = byFolder.get(conn.folderId) ?? []
      list.push(conn)
      byFolder.set(conn.folderId, list)
    }
  }

  const groups: Group[] = [
    { folderId: null, title: UNGROUPED_TITLE, connections: ungrouped }
  ]
  for (const folder of folders) {
    groups.push({
      folderId: folder.id,
      title: folder.name,
      connections: byFolder.get(folder.id) ?? [],
      folder
    })
  }

  const hasAnyConnection = data.length > 0

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 12
      }}
    >
      <Space
        style={{ marginBottom: 12 }}
        size="small"
        align="center"
        wrap={false}
      >
        <Text strong>连接</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {data.length}
        </Text>
        <div style={{ flex: 1 }} />
        <Tooltip title="新建目录">
          <Button
            type="text"
            size="small"
            icon={<FolderAddOutlined />}
            onClick={onCreateFolder}
            aria-label="新建目录"
          />
        </Tooltip>
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

      <div
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          marginRight: -8,
          paddingRight: 8
        }}
      >
        {loading && data.length === 0 ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : !hasAnyConnection ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text type="secondary" style={{ fontSize: 12 }}>
                还没有保存任何连接
              </Text>
            }
          />
        ) : (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {groups.map((group) => (
              <ConnectionGroup
                key={group.folderId ?? '__ungrouped__'}
                group={group}
                activeId={activeId}
                testingId={testingId}
                onActivate={onActivate}
                onEdit={onEdit}
                onDelete={onDelete}
                onTest={onTest}
                onEditFolder={onEditFolder}
                onDeleteFolder={onDeleteFolder}
              />
            ))}
          </Space>
        )}
      </div>
    </div>
  )
}

interface GroupProps {
  group: Group
  activeId: string | null
  testingId: string | null
  onActivate: (conn: EsConnection) => void
  onEdit: (conn: EsConnection) => void
  onDelete: (conn: EsConnection) => void
  onTest: (conn: EsConnection) => void
  onEditFolder: (folder: ConnectionFolder) => void
  onDeleteFolder: (folder: ConnectionFolder) => void
}

function ConnectionGroup({
  group,
  activeId,
  testingId,
  onActivate,
  onEdit,
  onDelete,
  onTest,
  onEditFolder,
  onDeleteFolder
}: GroupProps): JSX.Element {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 4px 4px 6px',
          fontSize: 12,
          color: 'var(--ant-color-text-secondary)'
        }}
      >
        <Text
          type="secondary"
          style={{ fontSize: 12, fontWeight: 500 }}
          ellipsis
        >
          {group.title}
        </Text>
        <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
          {group.connections.length}
        </Text>
        <div style={{ flex: 1 }} />
        {group.folder && (
          <Dropdown
            menu={{
              items: buildFolderMenuItems({
                onEdit: () => onEditFolder(group.folder as ConnectionFolder),
                onDelete: () => onDeleteFolder(group.folder as ConnectionFolder)
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
              aria-label="目录操作"
            />
          </Dropdown>
        )}
      </div>

      {group.connections.length === 0 ? (
        <div
          style={{
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--ant-color-text-tertiary, var(--ant-color-text-secondary))'
          }}
        >
          暂无连接
        </div>
      ) : (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          {group.connections.map((conn) => (
            <ConnectionRow
              key={conn.id}
              conn={conn}
              active={conn.id === activeId}
              testing={testingId === conn.id}
              onActivate={onActivate}
              onEdit={onEdit}
              onDelete={onDelete}
              onTest={onTest}
            />
          ))}
        </Space>
      )}
    </div>
  )
}

interface RowProps {
  conn: EsConnection
  active: boolean
  testing: boolean
  onActivate: (conn: EsConnection) => void
  onEdit: (conn: EsConnection) => void
  onDelete: (conn: EsConnection) => void
  onTest: (conn: EsConnection) => void
}

function ConnectionRow({
  conn,
  active,
  testing,
  onActivate,
  onEdit,
  onDelete,
  onTest
}: RowProps): JSX.Element {
  return (
    <div
      onClick={() => onActivate(conn)}
      style={{
        cursor: 'pointer',
        padding: '8px 10px',
        borderRadius: 6,
        border: active
          ? '1px solid var(--ant-color-primary)'
          : '1px solid transparent',
        background: active ? 'var(--ant-color-primary-bg)' : 'transparent',
        transition: 'background 0.15s'
      }}
    >
      <Space style={{ width: '100%' }} size={4} align="start">
        <Badge
          status={conn.authType === 'basic' ? 'processing' : 'default'}
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
            items: buildRowMenuItems({
              testing,
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
}

function buildRowMenuItems(handlers: {
  testing: boolean
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
}): NonNullable<MenuProps['items']> {
  return [
    {
      key: 'test',
      label: handlers.testing ? '测试中' : '测试连接',
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

function buildFolderMenuItems(handlers: {
  onEdit: () => void
  onDelete: () => void
}): NonNullable<MenuProps['items']> {
  return [
    {
      key: 'rename',
      label: '重命名',
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