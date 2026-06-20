/**
 * Connection folder modal.
 *
 * New / rename dialog for connection folders. The modal only owns
 * form state and validation; persistence happens in the parent
 * (`App.tsx`) through `useConnectionStore`.
 */

import { useEffect } from 'react'
import { Form, Input, Modal } from 'antd'
import type { ConnectionFolder } from '@shared/ipc'

export interface ConnectionFolderFormValues {
  id?: string
  name: string
}

interface Props {
  open: boolean
  initial?: ConnectionFolder | null
  onCancel: () => void
  onSubmit: (values: ConnectionFolderFormValues) => void
}

export default function ConnectionFolderModal({
  open,
  initial,
  onCancel,
  onSubmit
}: Props): JSX.Element {
  const [form] = Form.useForm<ConnectionFolderFormValues>()

  useEffect(() => {
    if (!open) return
    if (initial) {
      form.setFieldsValue({ id: initial.id, name: initial.name })
    } else {
      form.resetFields()
    }
  }, [open, initial, form])

  const handleOk = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      onSubmit(values)
    } catch {
      // antd already shows field-level errors
    }
  }

  return (
    <Modal
      open={open}
      title={initial ? '重命名目录' : '新建目录'}
      okText="保存"
      cancelText="取消"
      onCancel={onCancel}
      onOk={handleOk}
      destroyOnClose
      width={420}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          label="目录名称"
          name="name"
          rules={[
            { required: true, message: '请输入目录名称' },
            { max: 32, message: '目录名称不超过 32 个字符' }
          ]}
        >
          <Input placeholder="例如：本地开发" maxLength={32} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  )
}