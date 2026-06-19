/**
 * Connection form modal.
 *
 * Used for both "create new" and "edit existing" connections. Validation:
 *   - name: required
 *   - url: required, must start with http(s)://
 *   - authType: 'none' | 'basic'
 *   - username: required when authType === 'basic'
 *   - password: optional
 *
 * The component is dumb — it only collects values and reports them via
 * `onSubmit`. Persistence and ES calls happen in the parent (which uses
 * the connection store).
 */

import { useEffect } from 'react'
import {
  Form,
  Input,
  Modal,
  Radio,
  Space,
  Typography,
  Button,
  Alert
} from 'antd'
import type { ConnectionTestResult, EsConnection } from '@shared/ipc'

const { Text } = Typography

export interface ConnectionFormValues {
  id?: string
  name: string
  url: string
  authType: 'none' | 'basic'
  username?: string
  password?: string
}

interface Props {
  open: boolean
  initial?: EsConnection | null
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

  useEffect(() => {
    if (!open) return
    if (initial) {
      form.setFieldsValue({
        id: initial.id,
        name: initial.name,
        url: initial.url,
        authType: initial.authType,
        username: initial.username,
        password: initial.password
      })
    } else {
      form.resetFields()
      form.setFieldsValue({ authType: 'none' })
    }
  }, [open, initial, form])

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
        form={form}
        layout="vertical"
        initialValues={{ authType: 'none' }}
        preserve={false}
      >
        <Form.Item
          label="连接名称"
          name="name"
          rules={[{ required: true, message: '请输入连接名称' }]}
        >
          <Input placeholder="例如：本地开发" maxLength={64} />
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
                placeholder="（可选）"
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
