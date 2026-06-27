/**
 * Index template panel (V0.3.4 A-5).
 *
 * Self-contained modal that shows the connection-wide list of index
 * templates. From here the user can:
 *   - view an existing template body (read-only Monaco view)
 *   - create a new template (Monaco editor + name input)
 *   - delete a template (with confirm popover)
 *
 * Templates are connection-scoped, so the panel is mounted from
 * the workspace header (`WorkspacePage`) and not from a per-index
 * tab. The data is read directly from the workspace store; the
 * parent does not need to plumb anything through.
 *
 * The legacy / composable choice for new templates is exposed in
 * the create modal. Existing templates are listed with a small
 * tag so the user can see at a glance which API the template is
 * stored under.
 */

import { useState } from 'react'
import {
  App as AntdApp,
  Button,
  Empty,
  Modal,
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
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { EsIndexTemplateInfo } from '@shared/ipc'
import TemplateEditorModal from './TemplateEditorModal'

const { Text } = Typography

interface Props {
  open: boolean
  onClose: () => void
}

export default function TemplatePanel({ open, onClose }: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const templates = useWorkspaceStore((s) => s.templates)
  const loading = useWorkspaceStore((s) => s.templatesLoading)
  const error = useWorkspaceStore((s) => s.templatesError)
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const fetchTemplates = useWorkspaceStore((s) => s.fetchTemplates)
  const inspectTemplate = useWorkspaceStore((s) => s.inspectTemplate)
  const deleteTemplate = useWorkspaceStore((s) => s.deleteTemplate)

  const [createOpen, setCreateOpen] = useState(false)
  const [viewName, setViewName] = useState<string | null>(null)
  const [viewBody, setViewBody] = useState<Record<string, unknown> | null>(
    null
  )
  const [viewLegacy, setViewLegacy] = useState<boolean>(false)
  const [viewLoading, setViewLoading] = useState(false)
  const [deletingName, setDeletingName] = useState<string | null>(null)

  const handleView = async (name: string, legacy: boolean): Promise<void> => {
    if (!activeConnectionId) return
    setViewLoading(true)
    setViewName(name)
    setViewLegacy(legacy)
    setViewBody(null)
    try {
      const res = await inspectTemplate({
        connectionId: activeConnectionId,
        name
      })
      if (res?.success && res.data) {
        setViewBody(res.data.template)
        setViewLegacy(res.data.legacy)
      } else if (res) {
        message.error(`读取模板失败：${res.error?.message ?? '未知错误'}`)
        setViewName(null)
      }
    } finally {
      setViewLoading(false)
    }
  }

  const handleDelete = async (
    name: string,
    legacy: boolean
  ): Promise<void> => {
    if (!activeConnectionId) return
    setDeletingName(name)
    try {
      const res = await deleteTemplate({
        connectionId: activeConnectionId,
        name,
        legacy
      })
      if (res?.success) {
        message.success(`已删除索引模板 "${name}"`)
      } else if (res) {
        message.error(`删除模板失败：${res.error?.message ?? '未知错误'}`)
      }
    } finally {
      setDeletingName(null)
    }
  }

  const columns: ColumnsType<EsIndexTemplateInfo> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
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
      title: '类型',
      dataIndex: 'legacy',
      key: 'legacy',
      width: 200,
      render: (legacy: boolean) => (
        <Tag color={legacy ? 'gold' : 'geekblue'}>
          {legacy ? 'legacy (ES ≤ 7.7)' : 'composable (ES 7.8+)'}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: (_v, record) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            loading={viewLoading && viewName === record.name}
            onClick={() => void handleView(record.name, record.legacy)}
          >
            查看
          </Button>
          <Popconfirm
            title={`确定删除索引模板 "${record.name}" ？`}
            description="删除后使用该模板自动创建的索引不受影响，但新建的匹配索引将不再应用此模板。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => void handleDelete(record.name, record.legacy)}
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              loading={deletingName === record.name}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <>
      <Modal
        open={open}
        title="索引模板"
        onCancel={onClose}
        width={840}
        footer={null}
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space size="middle" wrap>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
            >
              新建模板
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                if (activeConnectionId) void fetchTemplates(activeConnectionId)
              }}
              loading={loading}
            >
              刷新
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              · 共 {templates.length} 个模板
            </Text>
          </Space>

          {error ? (
            <Text type="danger">无法加载索引模板：{error}</Text>
          ) : loading && templates.length === 0 ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : templates.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="该连接暂无索引模板，点击「新建模板」开始"
            />
          ) : (
            <Table<EsIndexTemplateInfo>
              rowKey="name"
              columns={columns}
              dataSource={templates}
              size="middle"
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
          )}
        </Space>
      </Modal>

      <TemplateEditorModal
        open={createOpen}
        mode="create"
        onClose={() => setCreateOpen(false)}
      />

      <TemplateEditorModal
        open={viewName !== null}
        mode="view"
        templateName={viewName ?? undefined}
        legacy={viewLegacy}
        templateBody={viewBody ?? undefined}
        onClose={() => {
          setViewName(null)
          setViewBody(null)
        }}
      />
    </>
  )
}
