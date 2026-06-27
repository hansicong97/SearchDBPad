/**
 * Alias edit modal (V0.3.4 A-4).
 *
 * Single-input modal for attaching a new alias to a given index. The
 * adapter is responsible for the actual `PUT /{index}/_alias/{alias}`
 * round-trip; the modal just collects the alias name and calls the
 * store's `addAlias` action.
 *
 * The server-side error (e.g. 400 on an invalid alias name, 403 when
 * the alias already exists) is surfaced verbatim via the message
 * toast — the renderer does not pre-validate alias-name syntax
 * because the rules drift across ES majors.
 */

import { useEffect, useState } from 'react'
import { App as AntdApp, Button, Form, Input, Modal, Space } from 'antd'
import { useWorkspaceStore } from '../stores/workspace.store'

interface Props {
  open: boolean
  indexName: string
  onClose: () => void
}

export default function AliasEditorModal({
  open,
  indexName,
  onClose
}: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const addAlias = useWorkspaceStore((s) => s.addAlias)

  const [form] = Form.useForm<{ alias: string }>()
  const [submitting, setSubmitting] = useState(false)

  // Re-seed on open so a previous draft does not leak across
  // opens (e.g. after a failed validation).
  useEffect(() => {
    if (open) {
      form.resetFields()
    }
  }, [open, form])

  const handleSubmit = async (): Promise<void> => {
    if (!activeConnectionId) {
      message.error('未选择连接')
      return
    }
    let values: { alias: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const alias = values.alias.trim()
    if (!alias) {
      message.error('Alias 名称不能为空')
      return
    }
    setSubmitting(true)
    try {
      const res = await addAlias({
        connectionId: activeConnectionId,
        index: indexName,
        alias
      })
      if (res?.success) {
        message.success(`已为索引 "${indexName}" 添加 Alias "${alias}"`)
        onClose()
      } else if (res) {
        message.error(`添加 Alias 失败：${res.error?.message ?? '未知错误'}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={`新增 Alias · ${indexName}`}
      onCancel={submitting ? undefined : onClose}
      width={520}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="primary"
            onClick={() => void handleSubmit()}
            loading={submitting}
          >
            提交
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
        preserve={false}
        // Re-mount when the modal opens so previous values disappear.
        key={open ? 'open' : 'closed'}
      >
        <Form.Item
          label="Alias 名称"
          name="alias"
          rules={[
            { required: true, message: '请输入 Alias 名称' },
            { whitespace: true, message: 'Alias 名称不能为空白' }
          ]}
        >
          <Input
            placeholder="例如：logs-current"
            allowClear
            maxLength={255}
            disabled={submitting}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
