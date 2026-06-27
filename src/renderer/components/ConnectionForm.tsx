/**
 * Connection form modal.
 *
 * Used for both "create new" and "edit existing" connections. Validation:
 *   - name: required (UI-side), with a server-side default fallback
 *   - url: required, must start with http(s)://
 *   - authType: 'none' | 'basic'
 *   - username: required when authType === 'basic'
 *   - password: optional
 *
 * V0.3.9 changes:
 *   - E-1: open flow always `resetFields()` before `setFieldsValue`
 *     so that values from a previous open (e.g. another connection's
 *     edit) can't bleed through.
 *   - E-4: the folder `<Select>` renders folders in their natural
 *     hierarchical order with indentation prefix so the user can
 *     tell parent and child folders apart at a glance.
 *   - E-5: name field is no longer `required` in the UI rules — the
 *     main process fills in `新建连接 N` when the user submits
 *     blank. Placeholder text explains the fallback.
 *
 * The component is dumb — it only collects values and reports them
 * via `onSubmit`. Persistence and ES calls happen in the parent
 * (which uses the connection store).
 */

import { useEffect, useMemo } from 'react'
import {
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Typography,
  Button,
  Alert
} from 'antd'
import type {
  ConnectionFolder,
  ConnectionTestResult,
  EsConnection
} from '@shared/ipc'

const { Text } = Typography

export interface ConnectionFormValues {
  id?: string
  name: string
  url: string
  authType: 'none' | 'basic'
  username?: string
  password?: string
  folderId?: string | null
}

interface Props {
  open: boolean
  initial?: EsConnection | null
  folders: ConnectionFolder[]
  submitting?: boolean
  testing?: boolean
  testResult?: ConnectionTestResult | null
  testError?: string | null
  onCancel: () => void
  onSubmit: (values: ConnectionFormValues) => void
  onTest: (values: ConnectionFormValues) => void
}

export default function ConnectionForm({
  open,
  initial,
  folders,
  submitting,
  testing,
  testResult,
  testError,
  onCancel,
  onSubmit,
  onTest
}: Props): JSX.Element {
  const [form] = Form.useForm<ConnectionFormValues>()
  const authType = Form.useWatch('authType', form) as 'none' | 'basic' | undefined

  // V0.3.9 E-4: render folder options in a stable order, top-level
  // first, then each folder's children. Each label is prefixed
  // with a depth-indicating gutter so the user can pick a nested
  // folder without having to open another dropdown.
  const folderOptions = useMemo(() => {
    const byParent = new Map<string | null, ConnectionFolder[]>()
    for (const f of folders) {
      const key = (f.parentId ?? null) as string | null
      const list = byParent.get(key) ?? []
      list.push(f)
      byParent.set(key, list)
    }
    const sorted = (xs: ConnectionFolder[]) =>
      [...xs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const out: Array<{ label: JSX.Element; value: string }> = []
    const walk = (parentId: string | null, depth: number): void => {
      for (const f of sorted(byParent.get(parentId) ?? [])) {
        const prefix = depth === 0 ? '' : '— '.repeat(depth)
        out.push({
          value: f.id,
          label: (
            <span>
              {prefix}
              {f.name}
            </span>
          )
        })
        walk(f.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [folders])

  // V0.3.9 E-1 (root cause fix): the previous resetFields +
  // setFieldsValue approach was unreliable for conditionally
  // rendered fields (username / password only show when
  // authType === 'basic'). With `destroyOnClose` + `preserve=
  // {false}`, antd's per-field register/destroy lifecycle races
  // with the setFieldsValue call, so the pre-set value can be
  // dropped before the field's first render. Now we drive the
  // form purely off `initialValues` + a `key` (set below on the
  // Form) that changes every time the modal opens OR the
  // edited connection changes. A fresh Form mounts with every
  // field registered with its initial value from frame 0; no
  // setFieldsValue is needed.
  // The useEffect is kept only to clear any leftover test
  // banner when the modal closes (the parent also resets
  // these, so it's defensive).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    // No-op: the Form below uses `initialValues` + a `key`, so
    // every field is correctly seeded on mount. Resetting here
    // would actually clobber the seed values.
  }, [open, initial?.id, form])

  // The Form's `key` forces a brand-new mount whenever the
  // modal opens or the target connection changes. Combined
  // with `initialValues`, this guarantees the field values
  // visible on first render match the connection being edited.
  const formKey = open ? (initial?.id ?? 'new') : 'closed'

  const formInitialValues: ConnectionFormValues = initial
    ? {
        name: initial.name,
        url: initial.url,
        authType: initial.authType,
        username: initial.username,
        // V0.3.9 security: never pre-fill the saved password. The
        // input below is masked regardless, but seeding the value
        // would also persist it in the form's internal state and
        // round-trip it back to the service on submit if the user
        // didn't touch the field. A blank password on the update
        // payload tells the service to preserve the stored one.
        password: undefined,
        folderId: initial.folderId ?? null
      }
    : {
        name: '',
        url: '',
        authType: 'none',
        username: undefined,
        password: undefined,
        folderId: null
      }

  const triggerTest = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      onTest(values)
    } catch {
      // antd has already surfaced field-level errors
    }
  }

  const handleOk = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      onSubmit(values)
    } catch {
      // antd has already surfaced field-level errors
    }
  }

  return (
    <Modal
      open={open}
      title={initial ? '编辑连接' : '新建连接'}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={handleOk}
      destroyOnClose
      width={560}
    >
      <Form
        key={formKey}
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={formInitialValues}
      >
        <Form.Item
          label="连接名称"
          name="name"
          // V0.3.9 E-5: drop the `required` rule so the user can
          // submit blank and let the main process fill in a
          // default. Length cap stays.
          rules={[{ max: 64, message: '连接名称不超过 64 个字符' }]}
        >
          <Input placeholder="例如：本地开发（留空将使用默认名）" maxLength={64} />
        </Form.Item>

        <Form.Item
          label="Elasticsearch 地址"
          name="url"
          rules={[
            { required: true, message: '请输入 Elasticsearch 地址' },
            {
              pattern: /^https?:\/\//i,
              message: '地址必须以 http:// 或 https:// 开头'
            }
          ]}
        >
          <Input placeholder="http://localhost:9200" />
        </Form.Item>

        <Form.Item label="认证方式" name="authType">
          <Radio.Group>
            <Radio.Button value="none">无认证</Radio.Button>
            <Radio.Button value="basic">Basic Auth</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item label="目录" name="folderId">
          <Select
            allowClear
            placeholder="未分组"
            options={folderOptions}
            optionFilterProp="label"
            notFoundContent={
              <Text type="secondary" style={{ fontSize: 12 }}>
                还没有目录，可先保存为“未分组”
              </Text>
            }
          />
        </Form.Item>

        {authType === 'basic' && (
          <Space style={{ display: 'flex' }} size="middle">
            <Form.Item
              label="用户名"
              name="username"
              style={{ minWidth: 200 }}
              rules={[
                { required: true, message: 'Basic Auth 模式下用户名不能为空' }
              ]}
            >
              <Input placeholder="elastic" autoComplete="off" />
            </Form.Item>
            <Form.Item label="密码" name="password" style={{ minWidth: 200 }}>
              <Input.Password
                placeholder={
                  initial ? '（留空表示不修改）' : '（可选）'
                }
                autoComplete="new-password"
              />
            </Form.Item>
          </Space>
        )}
      </Form>

      <Space style={{ marginTop: 4 }}>
        <Button onClick={triggerTest} loading={testing}>
          测试连接
        </Button>
        <Text type="secondary">
          测试不会保存配置，可在保存前验证地址和凭据。
        </Text>
      </Space>

      {testError && (
        <Alert
          style={{ marginTop: 12 }}
          type="error"
          showIcon
          message="测试失败"
          description={testError}
        />
      )}
      {testResult && !testError && (
        <Alert
          style={{ marginTop: 12 }}
          type={testResult.reachable ? 'success' : 'error'}
          showIcon
          message={
            testResult.reachable
              ? '连接成功'
              : '无法连接到 Elasticsearch'
          }
          description={
            <Space direction="vertical" size={2}>
              {testResult.clusterName && (
                <Text>集群名：{testResult.clusterName}</Text>
              )}
              {testResult.version && <Text>版本：{testResult.version}</Text>}
              {testResult.health && <Text>健康：{testResult.health}</Text>}
              {testResult.message && <Text>{testResult.message}</Text>}
            </Space>
          }
        />
      )}
    </Modal>
  )
}