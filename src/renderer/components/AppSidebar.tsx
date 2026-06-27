/**
 * Left sidebar (phase 3 + 15 UI update + V0.3.9).
 *
 * Shows the connection list grouped by user-defined folders. The implicit
 * "未分组" bucket is rendered first and holds any connection whose
 * `folderId` is null/undefined (including legacy phase 2 entries).
 *
 * V0.3.9 changes:
 *   - E-2: each connection row uses an explicit flex container so the
 *     "三点菜单" stays pinned to the right edge regardless of name
 *     length. The previous antd `Space` layout would let the menu
 *     wrap to a second line on very long names.
 *   - E-3: connection rows are draggable; folder rows + the
 *     "未分组" area are drop targets. A successful drop calls
 *     `onMoveToFolder(connId, folderId|null)`; the drag itself
 *     does NOT activate the connection. The row menu also exposes
 *     a "移动到目录" submenu so users who prefer clicking can do
 *     the same thing.
 *   - E-4: folders may nest via `parentId`. The sidebar walks the
 *     tree top-down, indenting each level; the folder menu adds a
 *     "新建子目录" item that opens the folder modal pre-bound to
 *     the parent.
 */

import { useState } from 'react'
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
  FileAddOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
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
  /** V0.3.9 E-4: open the folder modal pre-bound to `parentId`. */
  onCreateSubfolder: (parent: ConnectionFolder) => void
  onEditFolder: (folder: ConnectionFolder) => void
  onDeleteFolder: (folder: ConnectionFolder) => void
  /** V0.3.9 E-3: invoked when a connection is dragged into a
   *  folder (or the implicit "未分组" bucket, in which case the
   *  second argument is `null`). */
  onMoveToFolder: (conn: EsConnection, folderId: string | null) => void
}

const UNGROUPED_TITLE = '未分组'

/** V0.3.9 E-4: render the folder tree as a flat ordered list with
 *  a depth field, so the JSX below can stay a single map and the
 *  indentation only affects styling. Each row in the output is
 *  one of these groups. */
interface Group {
  /** `null` for the implicit "未分组" bucket; otherwise folder id. */
  folderId: string | null
  title: string
  depth: number
  connections: EsConnection[]
  /** Undefined for the implicit bucket (no rename/delete/create). */
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
  onCreateSubfolder,
  onEditFolder,
  onDeleteFolder,
  onMoveToFolder
}: Props): Props['data'] extends never ? never : JSX.Element {
  // V0.3.9 E-3: dragged connection id lives in state so the drop
  // handler on every folder can read it. We don't render any UI
  // for the dragged row itself — antd's built-in browser drag
  // image is good enough.
  const [draggedConnId, setDraggedConnId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  // Build the folder tree in stable order: top-level first, then
  // each folder's children, oldest first within a sibling set.
  const groups: Group[] = (() => {
    const byParent = new Map<string | null, ConnectionFolder[]>()
    for (const f of folders) {
      const key = (f.parentId ?? null) as string | null
      const list = byParent.get(key) ?? []
      list.push(f)
      byParent.set(key, list)
    }
    const sorted = (xs: ConnectionFolder[]) =>
      [...xs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const connectionsByFolder = new Map<string | null, EsConnection[]>()
    for (const c of data) {
      const key = (c.folderId ?? null) as string | null
      const list = connectionsByFolder.get(key) ?? []
      list.push(c)
      connectionsByFolder.set(key, list)
    }

    const out: Group[] = []
    const walk = (parentId: string | null, depth: number): void => {
      if (parentId === null) {
        out.push({
          folderId: null,
          title: UNGROUPED_TITLE,
          depth: 0,
          connections: connectionsByFolder.get(null) ?? []
        })
      }
      for (const f of sorted(byParent.get(parentId) ?? [])) {
        out.push({
          folderId: f.id,
          title: f.name,
          depth,
          connections: connectionsByFolder.get(f.id) ?? [],
          folder: f
        })
        walk(f.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  })()

  const hasAnyConnection = data.length > 0

  // V0.3.9 E-3: handlers reused by every folder row and the
  // "未分组" row. They read `draggedConnId` from state, look up
  // the connection, and forward to `onMoveToFolder`.
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    // Without preventDefault the browser won't fire `drop`. We also
    // flip the cursor to "grab" so the user sees the affordance.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const handleDragLeave = (
    _e: React.DragEvent<HTMLDivElement>,
    targetId: string | null
  ): void => {
    if (dropTargetId === targetId) setDropTargetId(null)
  }
  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    targetId: string | null
  ): void => {
    e.preventDefault()
    setDropTargetId(null)
    const connId = e.dataTransfer.getData('application/x-sdbp-conn')
    setDraggedConnId(null)
    if (!connId) return
    const conn = data.find((c) => c.id === connId)
    if (!conn) return
    // No-op when the connection already lives in this folder.
    const currentFolderId = (conn.folderId ?? null) as string | null
    if (currentFolderId === targetId) return
    onMoveToFolder(conn, targetId)
  }

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
                draggedConnId={draggedConnId}
                isDropTarget={dropTargetId === group.folderId}
                folders={folders}
                onActivate={onActivate}
                onEdit={onEdit}
                onDelete={onDelete}
                onTest={onTest}
                onEditFolder={onEditFolder}
                onDeleteFolder={onDeleteFolder}
                onCreateSubfolder={onCreateSubfolder}
                onMoveToFolder={onMoveToFolder}
                onDragStart={(connId) => setDraggedConnId(connId)}
                onDragEnd={() => {
                  setDraggedConnId(null)
                  setDropTargetId(null)
                }}
                onDragOver={(e) => {
                  handleDragOver(e)
                  if (dropTargetId !== group.folderId) {
                    setDropTargetId(group.folderId)
                  }
                }}
                onDragLeave={(e) => handleDragLeave(e, group.folderId)}
                onDrop={(e) => handleDrop(e, group.folderId)}
              />
            ))}
          </Space>
        )}
      </div>
    </div>
  ) as JSX.Element
}

interface GroupProps {
  group: Group
  activeId: string | null
  testingId: string | null
  draggedConnId: string | null
  isDropTarget: boolean
  folders: ConnectionFolder[]
  onActivate: (conn: EsConnection) => void
  onEdit: (conn: EsConnection) => void
  onDelete: (conn: EsConnection) => void
  onTest: (conn: EsConnection) => void
  onEditFolder: (folder: ConnectionFolder) => void
  onDeleteFolder: (folder: ConnectionFolder) => void
  onCreateSubfolder: (parent: ConnectionFolder) => void
  onMoveToFolder: (conn: EsConnection, folderId: string | null) => void
  onDragStart: (connId: string) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void
}

function ConnectionGroup({
  group,
  activeId,
  testingId,
  draggedConnId,
  isDropTarget,
  folders,
  onActivate,
  onEdit,
  onDelete,
  onTest,
  onEditFolder,
  onDeleteFolder,
  onCreateSubfolder,
  onMoveToFolder,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop
}: GroupProps): JSX.Element {
  // Indent nested groups so the hierarchy is visible at a glance.
  // The ungrouped bucket stays flush-left.
  const indent = group.depth * 12

  return (
    <div>
      <div
        // V0.3.9 E-3: every group header is a drop target.
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 4px 4px 6px',
          paddingLeft: 6 + indent,
          fontSize: 12,
          color: 'var(--ant-color-text-secondary)',
          borderRadius: 4,
          background: isDropTarget
            ? 'var(--ant-color-primary-bg)'
            : 'transparent',
          transition: 'background 0.12s'
        }}
      >
        {group.depth > 0 && (
          <FolderOpenOutlined
            style={{ fontSize: 12, marginRight: 4, opacity: 0.6 }}
          />
        )}
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
                folder: group.folder,
                onCreateSubfolder: () => onCreateSubfolder(group.folder as ConnectionFolder),
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
            paddingLeft: 10 + indent,
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
              isDragging={conn.id === draggedConnId}
              indent={indent}
              folders={folders}
              currentFolderId={(group.folderId ?? null) as string | null}
              onActivate={onActivate}
              onEdit={onEdit}
              onDelete={onDelete}
              onTest={onTest}
              onMoveToFolder={onMoveToFolder}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
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
  isDragging: boolean
  indent: number
  folders: ConnectionFolder[]
  currentFolderId: string | null
  onActivate: (conn: EsConnection) => void
  onEdit: (conn: EsConnection) => void
  onDelete: (conn: EsConnection) => void
  onTest: (conn: EsConnection) => void
  onMoveToFolder: (conn: EsConnection, folderId: string | null) => void
  onDragStart: (connId: string) => void
  onDragEnd: () => void
}

function ConnectionRow({
  conn,
  active,
  testing,
  isDragging,
  indent,
  folders,
  currentFolderId,
  onActivate,
  onEdit,
  onDelete,
  onTest,
  onMoveToFolder,
  onDragStart,
  onDragEnd
}: RowProps): JSX.Element {
  return (
    <div
      // V0.3.9 E-3: HTML5 drag source. Setting the dataTransfer
      // payload lets the drop target identify which connection
      // was being dragged. We intentionally use a custom
      // mime type so unrelated drag events (e.g. text
      // selection) don't accidentally trigger a move.
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-sdbp-conn', conn.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(conn.id)
      }}
      onDragEnd={onDragEnd}
      // V0.3.9 E-3: still allow click-to-activate, but skip
      // it while a drag is in progress. The drag end fires
      // before the next click in every browser we've seen, so
      // the active state stays correct.
      onClick={() => {
        if (isDragging) return
        onActivate(conn)
      }}
      style={{
        cursor: 'pointer',
        padding: '8px 10px',
        paddingLeft: 10 + indent,
        borderRadius: 6,
        border: active
          ? '1px solid var(--ant-color-primary)'
          : '1px solid transparent',
        background: active ? 'var(--ant-color-primary-bg)' : 'transparent',
        opacity: isDragging ? 0.4 : 1,
        transition: 'background 0.15s, opacity 0.15s'
      }}
    >
      {/*
        V0.3.9 E-2: explicit flex container so the "三点菜单"
        button stays pinned to the right edge regardless of name
        length. The middle column uses `min-width: 0` so the
        long-name ellipsis actually clips instead of pushing the
        menu off-screen.
      */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          width: '100%'
        }}
      >
        <Badge
          status={conn.authType === 'basic' ? 'processing' : 'default'}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Tooltip title={conn.name} placement="topLeft">
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
          </Tooltip>
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
              conn,
              currentFolderId,
              folders,
              onTest: () => onTest(conn),
              onEdit: () => onEdit(conn),
              onDelete: () => onDelete(conn),
              onMove: (folderId) => onMoveToFolder(conn, folderId)
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
      </div>
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
  conn: EsConnection
  currentFolderId: string | null
  folders: ConnectionFolder[]
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
  onMove: (folderId: string | null) => void
}): NonNullable<MenuProps['items']> {
  const {
    testing,
    conn,
    currentFolderId,
    folders,
    onTest,
    onEdit,
    onDelete,
    onMove
  } = handlers

  // V0.3.9 E-3: "移动到目录" submenu. We list every folder
  // (with indentation prefix so the hierarchy is visible) plus
  // an explicit "未分组" item. The current folder is rendered
  // disabled so the menu stays honest.
  const folderItems: NonNullable<MenuProps['items']> = [
    {
      key: '__ungrouped__',
      label: UNGROUPED_TITLE,
      disabled: currentFolderId === null,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation()
        onMove(null)
      }
    },
    ...folders.map<NonNullable<MenuProps['items']>[number]>((f) => ({
      key: f.id,
      // V0.3.9 E-4: render the folder tree with indentation in
      // the menu labels so the user can see hierarchy at a glance.
      label: indentLabel(f, folders),
      disabled: currentFolderId === f.id,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation()
        onMove(f.id)
      }
    }))
  ]

  return [
    {
      key: 'test',
      label: testing ? '测试中' : '测试连接',
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
    {
      key: 'move',
      label: '移动到目录',
      icon: <FileAddOutlined />,
      // E-3: submenu is rendered as nested children of this item.
      children: folderItems
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
  folder: ConnectionFolder
  onCreateSubfolder: () => void
  onEdit: () => void
  onDelete: () => void
}): NonNullable<MenuProps['items']> {
  return [
    {
      // V0.3.9 E-4: create a child folder directly under this one.
      // The parent folder id is propagated through the modal.
      key: 'createSubfolder',
      label: '新建子目录',
      icon: <FileAddOutlined />,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation()
        handlers.onCreateSubfolder()
      }
    },
    { type: 'divider' },
    {
      key: 'rename',
      label: '重命名',
      icon: <EditOutlined />,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation()
        handlers.onEdit()
      }
    },
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

/** Walk up `parentId` chain to compute the depth of `folder` so the
 *  menu label can prefix it with the right amount of `— ` gutter. */
function indentLabel(
  folder: ConnectionFolder,
  all: ConnectionFolder[]
): string {
  let depth = 0
  let cursor: string | null | undefined = folder.parentId
  const seen = new Set<string>()
  while (cursor) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const parent = all.find((f) => f.id === cursor)
    if (!parent) break
    depth += 1
    cursor = parent.parentId
  }
  const prefix = depth === 0 ? '' : '— '.repeat(depth)
  return `${prefix}${folder.name}`
}