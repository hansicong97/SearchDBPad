/**
 * DSL favorite modal (V0.3.5 B-4).
 *
 * Combined save / list / delete UI for favorite DSL queries.
 * Opened from the DslQueryPanel toolbar.
 *
 *   - The "保存当前为收藏" section captures the live editor
 *     content (`currentDsl`) along with a user-supplied name and
 *     an optional index-name label, then calls `createDslFavorite`
 *     on the store. Invalid JSON is caught client-side and the
 *     submit button stays disabled.
 *   - The list section renders every persisted favorite with a
 *     "使用" button (loads the DSL into the parent editor) and a
 *     "删除" button (Popconfirm).
 *   - The favorite is loaded into the parent via the `onSelect`
 *     callback — the modal itself does not own the editor state.
 *
 * The renderer never reads or writes the favorites file directly;
 * all I/O goes through `window.esApi.dslFavorites.*` → main process
 * service layer.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Empty,
  Form,
  Input,
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
  PlayCircleOutlined,
  ReloadOutlined,
  StarOutlined
} from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { DslFavorite } from '@shared/ipc'

const { Text } = Typography

interface Props {
  open: boolean
  /** The DSL JSON currently in the editor. Captured by the parent
   *  at open time so edits made inside the modal don't drift from
   *  what the user is going to save. */
  currentDsl: string
  /** The currently selected index name, used as the default
   *  index-name label on save. */
  currentIndexName: string
  onClose: () => void
  /** Called when the user picks a favorite from the list. The
   *  parent is responsible for loading the DSL into the editor. */
  onSelect: (favorite: DslFavorite) => void
}

interface SaveFormValues {
  name: string
  indexName: string
}

export default function DslFavoriteModal({
  open,
  currentDsl,
  currentIndexName,
  onClose,
  onSelect
}: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const favorites = useWorkspaceStore((s) => s.dslFavorites)
  const loading = useWorkspaceStore((s) => s.dslFavoritesLoading)
  const error = useWorkspaceStore((s) => s.dslFavoritesError)
  const fetchDslFavorites = useWorkspaceStore((s) => s.fetchDslFavorites)
  const createDslFavorite = useWorkspaceStore((s) => s.createDslFavorite)
  const deleteDslFavorite = useWorkspaceStore((s) => s.deleteDslFavorite)

  const [form] = Form.useForm<SaveFormValues>()
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Re-fetch on open so the list reflects the latest state (in case
  // another panel modified it). Reset the save form to its defaults
  // each time we open so a previous draft doesn't leak.
  useEffect(() => {
    if (!open) return
    void fetchDslFavorites()
    form.resetFields()
    form.setFieldsValue({ indexName: currentIndexName })
  }, [open, currentIndexName, fetchDslFavorites, form])

  // Disable the submit button when the current DSL fails to parse
  // as a JSON object — the service layer would reject it anyway,
  // but a disabled button gives a clearer signal to the user.
  const isCurrentDslValid = useMemo<boolean>(() => {
    try {
      const parsed = JSON.parse(currentDsl) as unknown
      return (
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      )
    } catch {
      return false
    }
  }, [currentDsl])

  const handleSave = async (): Promise<void> => {
    if (!isCurrentDslValid) {
      message.error('当前 DSL 不是合法 JSON 对象，无法保存')
      return
    }
    let values: SaveFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const name = values.name.trim()
    if (!name) {
      message.error('收藏名称不能为空')
      return
    }
    setSaving(true)
    try {
      const res = await createDslFavorite({
        name,
        indexName: values.indexName?.trim() ?? '',
        dsl: currentDsl
      })
      if (res?.success) {
        message.success(`已保存收藏 "${name}"`)
        form.resetFields()
        form.setFieldsValue({ indexName: currentIndexName })
      } else if (res) {
        message.error(`保存失败：${res.error?.message ?? '未知错误'}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, name: string): Promise<void> => {
    setDeletingId(id)
    try {
      const res = await deleteDslFavorite(id)
      if (res?.success) {
        message.success(`已删除收藏 "${name}"`)
      } else if (res) {
        message.error(`删除失败：${res.error?.message ?? '未知错误'}`)
      }
    } finally {
      setDeletingId(null)
    }
  }

  const columns: ColumnsType<DslFavorite> = [
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
      title: '关联索引',
      dataIndex: 'indexName',
      key: 'indexName',
      width: 180,
      ellipsis: true,
      render: (v: string) =>
        v ? (
          <Tooltip title={v} placement="topLeft">
            <Tag color="blue">{v}</Tag>
          </Tooltip>
        ) : (
          <Text type="secondary">-</Text>
        )
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 200,
      render: (v: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {v.replace('T', ' ').replace(/\..+$/, '')}
        </Text>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      fixed: 'right',
      render: (_v, record) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={() => {
              onSelect(record)
              onClose()
            }}
          >
            使用
          </Button>
          <Popconfirm
            title={`确定删除收藏 "${record.name}" ？`}
            description="删除后无法恢复，需要重新保存。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => void handleDelete(record.id, record.name)}
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              loading={deletingId === record.id}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <Modal
      open={open}
      title="DSL 收藏"
      onCancel={onClose}
      width={760}
      destroyOnClose
      footer={
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void fetchDslFavorites()}
            loading={loading}
          >
            刷新
          </Button>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Form
          form={form}
          layout="inline"
          preserve={false}
          // Re-mount on open so a previous draft disappears.
          key={open ? 'open' : 'closed'}
        >
          <Form.Item
            label="收藏名称"
            name="name"
            rules={[
              { required: true, message: '请输入收藏名称' },
              { whitespace: true, message: '收藏名称不能为空白' }
            ]}
            style={{ flex: 1, minWidth: 220 }}
          >
            <Input placeholder="例如：最近一小时错误日志" allowClear />
          </Form.Item>
          <Form.Item
            label="关联索引"
            name="indexName"
            tooltip="仅作为标签记录，不影响加载时的实际索引"
            style={{ flex: 1, minWidth: 180 }}
          >
            <Input placeholder="例如：logs-2025-06" allowClear />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              icon={<StarOutlined />}
              loading={saving}
              disabled={!isCurrentDslValid}
              onClick={() => void handleSave()}
            >
              保存当前为收藏
            </Button>
          </Form.Item>
        </Form>

        {!isCurrentDslValid ? (
          <Text type="warning" style={{ fontSize: 12 }}>
            当前 DSL 不是合法 JSON 对象，无法保存。请先修正编辑器内容。
          </Text>
        ) : null}

        {error ? (
          <Text type="danger">无法加载收藏列表：{error}</Text>
        ) : loading && favorites.length === 0 ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : favorites.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无收藏，输入名称并点击「保存当前为收藏」开始"
          />
        ) : (
          <Table<DslFavorite>
            rowKey="id"
            columns={columns}
            dataSource={favorites}
            size="middle"
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        )}
      </Space>
    </Modal>
  )
}
