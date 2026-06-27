/**
 * Connection folder modal.
 *
 * New / rename dialog for connection folders. The modal only owns
 * form state and validation; persistence happens in the parent
 * (`App.tsx`) through `useConnectionStore`.
 *
 * V0.3.9 E-4: the modal now carries an optional `parentId` prop so
 * the folder menu's "新建子目录" action can open it pre-bound to a
 * parent. The id is sent through to the main process on submit;
 * renaming an existing folder ignores `parentId` (the service
 * deliberately doesn't support re-parenting yet).
 *
 * V0.3.9 E-5: empty name submission gets a default
 * `新建目录 N` server-side; the UI surfaces the same wording in
 * the placeholder so the user knows the fallback exists.
 */

import { useEffect } from 'react'
import { Form, Input, Modal } from 'antd'
import type { ConnectionFolder } from '@shared/ipc'

export interface ConnectionFolderFormValues {
  id?: string
  name: string
  /** V0.3.9 E-4: when creating a nested folder, carry the
   *  parent's id through to the service. */
  parentId?: string | null
}

interface Props {
  open: boolean
  initial?: ConnectionFolder | null
  /** V0.3.9 E-4: id of the parent folder when the modal was
   *  opened from a folder's "新建子目录" menu item. Ignored when
   *  `initial` is set (rename flow). */
  parentId?: string | null
  onCancel: () => void
  onSubmit: (values: ConnectionFolderFormValues) => void
}

export default function ConnectionFolderModal({
  open,
  initial,
  parentId,
  onCancel,
  onSubmit
}: Props): JSX.Element {
  const [form] = Form.useForm<ConnectionFolderFormValues>()

  useEffect(() => {
    if (!open) return
    if (initial) {
      // Rename flow: keep the persisted parentId; the service
      // ignores `parentId` on update anyway.
      form.setFieldsValue({
        id: initial.id,
        name: initial.name,
        parentId: initial.parentId ?? null
      })
    } else {
      form.resetFields()
      form.setFieldsValue({ parentId: parentId ?? null })
    }
  }, [open, initial, parentId, form])

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
          // E-5: only enforce a max length; the service fills in a
          // numbered default when the user submits blank, so the
          // `required` rule is intentionally absent.
          rules={[{ max: 32, message: '目录名称不超过 32 个字符' }]}
        >
          <Input
            placeholder="例如：本地开发（留空将使用默认名）"
            maxLength={32}
            autoFocus
          />
        </Form.Item>
        {/* Hidden carrier for parentId so the form value flows
            through `validateFields` without surfacing a visible
            field. UI-side picking of the parent is reserved for a
            future version; for V0.3.9 the parent is always set by
            the folder whose "新建子目录" action opened the modal. */}
        <Form.Item name="parentId" hidden>
          <Input type="hidden" />
        </Form.Item>
      </Form>
    </Modal>
  )
}