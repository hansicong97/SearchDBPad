/**
 * Template editor modal (V0.3.4 A-5).
 *
 * Monaco-based JSON editor for an index template body. Two modes:
 *
 *   - `view`    — read-only viewer for an existing template. Shows
 *                 the raw payload returned by `index-template:get`,
 *                 the legacy / composable tag, and a single
 *                 「关闭」 button.
 *
 *   - `create`  — editable form for a new template. Provides name
 *                 input, legacy / composable toggle, 「格式化」 and
 *                 「提交」 buttons, and a JSON validity tag mirroring
 *                 the Settings / Mapping editor pattern.
 *
 * The legacy vs composable choice is rendered as a `legacy` prop and
 * submitted to the adapter; the adapter translates it into the
 * right ES endpoint (`/_template` vs `/_index_template`). The
 * renderer does not need to know about the cluster version.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Space,
  Spin,
  Tag,
  Typography
} from 'antd'
import {
  CheckCircleOutlined,
  CodeOutlined,
  SaveOutlined
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import { useWorkspaceStore } from '../stores/workspace.store'

// Side-effect import — wires Monaco workers + loader config before
// the editor is rendered, identical to DslQueryPanel and the
// Settings/Mapping editors.
import './monacoEnv'

const { Text, Paragraph } = Typography

const DEFAULT_TEMPLATE = `{
  "index_patterns": ["my-index-*"],
  "settings": {
    "number_of_shards": 1
  },
  "mappings": {
    "properties": {
      "message": { "type": "text" }
    }
  }
}`

const DEFAULT_LEGACY_TEMPLATE = `{
  "index_patterns": ["my-index-*"],
  "settings": {
    "number_of_shards": 1
  },
  "mappings": {
    "properties": {
      "message": { "type": "text" }
    }
  }
}`

interface Props {
  open: boolean
  mode: 'view' | 'create'
  /** Required in `view` mode. The body to render read-only. */
  templateName?: string
  /** Required in `view` mode. The legacy flag for tagging. */
  legacy?: boolean
  /** Required in `view` mode. The template body to display. */
  templateBody?: Record<string, unknown>
  onClose: () => void
  /** Called after a successful create, so the parent can
   *  close the modal. */
  onCreated?: (name: string) => void
}

interface CreateFormValues {
  name: string
  legacy: boolean
}

export default function TemplateEditorModal({
  open,
  mode,
  templateName,
  legacy,
  templateBody,
  onClose,
  onCreated
}: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const createTemplate = useWorkspaceStore((s) => s.createTemplate)

  const [form] = Form.useForm<CreateFormValues>()
  const [text, setText] = useState<string>('{}')
  const [submitting, setSubmitting] = useState(false)

  // Re-seed the editor on every open so a stale draft cannot
  // overwrite new server values.
  useEffect(() => {
    if (!open) return
    if (mode === 'view') {
      setText(
        templateBody ? JSON.stringify(templateBody, null, 2) : '{}'
      )
      return
    }
    form.resetFields()
    form.setFieldsValue({ legacy: legacy ?? false })
    setText(legacy ? DEFAULT_LEGACY_TEMPLATE : DEFAULT_TEMPLATE)
  }, [open, mode, templateBody, legacy, form])

  /** Live validity tag — Monaco itself flags errors inline, but
   *  the tag keeps the toolbar honest about whether submit will
   *  succeed. */
  const isValidJson = useMemo<boolean>(() => {
    try {
      JSON.parse(text)
      return true
    } catch {
      return false
    }
  }, [text])

  const handleFormat = (): void => {
    try {
      const parsed = JSON.parse(text) as unknown
      setText(JSON.stringify(parsed, null, 2))
    } catch (err) {
      message.error(`JSON 不合法：${(err as Error).message}`)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    if (!activeConnectionId) {
      message.error('未选择连接')
      return
    }
    let values: CreateFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const name = values.name.trim()
    if (!name) {
      message.error('模板名称不能为空')
      return
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch (err) {
      message.error(`JSON 解析失败：${(err as Error).message}`)
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      message.error('模板内容必须是 JSON 对象')
      return
    }
    setSubmitting(true)
    try {
      const res = await createTemplate({
        connectionId: activeConnectionId,
        name,
        legacy: values.legacy,
        template: parsed
      })
      if (res?.success) {
        message.success(`已创建索引模板 "${name}"`)
        onCreated?.(name)
        onClose()
      } else if (res) {
        message.error(`创建模板失败：${res.error?.message ?? '未知错误'}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const isView = mode === 'view'

  return (
    <Modal
      open={open}
      title={
        isView
          ? `查看模板 · ${templateName ?? ''}`
          : '创建索引模板'
      }
      onCancel={submitting ? undefined : onClose}
      width={760}
      destroyOnClose
      footer={
        isView ? (
          <Button onClick={onClose}>关闭</Button>
        ) : (
          <Space>
            <Button onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => void handleSubmit()}
              loading={submitting}
              disabled={!isValidJson}
            >
              提交
            </Button>
          </Space>
        )
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {isView ? (
          <Space size="small">
            <Tag color={legacy ? 'gold' : 'geekblue'}>
              {legacy ? 'legacy (ES ≤ 7.7)' : 'composable (ES 7.8+)'}
            </Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              只读视图，如需修改请先删除后重新创建
            </Text>
          </Space>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              message="创建索引模板"
              description={
                <Paragraph style={{ marginBottom: 0 }}>
                  模板决定了匹配 <Text code>index_patterns</Text> 的索引创建时的 Settings 和
                  Mapping。文案会以 <Text code>index_patterns</Text>、
                  <Text code>settings</Text>、<Text code>mappings</Text> 的形式提交。
                  legacy 模板走 <Text code>PUT /_template/{'{name}'}</Text>，composable
                  模板走 <Text code>PUT /_index_template/{'{name}'}</Text>。
                </Paragraph>
              }
            />
            <Form
              form={form}
              layout="vertical"
              autoComplete="off"
              preserve={false}
              // Re-mount on open so previous values disappear.
              key={open ? 'open' : 'closed'}
            >
              <Form.Item
                label="模板名称"
                name="name"
                rules={[
                  { required: true, message: '请输入模板名称' },
                  { whitespace: true, message: '模板名称不能为空白' }
                ]}
              >
                <Input
                  placeholder="例如：logs-template"
                  allowClear
                  maxLength={255}
                  disabled={submitting}
                />
              </Form.Item>
              <Form.Item label="模板类型" name="legacy" initialValue={false}>
                <Radio.Group disabled={submitting}>
                  <Radio value={false}>Composable (ES 7.8+)</Radio>
                  <Radio value={true}>Legacy (ES ≤ 7.7)</Radio>
                </Radio.Group>
              </Form.Item>
            </Form>
          </>
        )}
        <Space size="small">
          <Button
            size="small"
            icon={<CheckCircleOutlined />}
            onClick={handleFormat}
            disabled={isView}
          >
            格式化
          </Button>
          <Tag color={isValidJson ? 'success' : 'error'} style={{ margin: 0 }}>
            {isValidJson ? 'JSON 合法' : 'JSON 不合法'}
          </Tag>
        </Space>
        <Spin spinning={submitting}>
          <div
            style={{
              border: '1px solid var(--ant-color-border-secondary)',
              borderRadius: 4,
              overflow: 'hidden',
              background: 'var(--ant-color-bg-container)'
            }}
          >
            <Editor
              height="360px"
              defaultLanguage="json"
              theme="vs"
              value={text}
              onChange={(v) => setText(v ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                tabSize: 2,
                insertSpaces: true,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                formatOnPaste: false,
                wordWrap: 'on',
                readOnly: isView
              }}
              loading={<CodeOutlined />}
            />
          </div>
        </Spin>
      </Space>
    </Modal>
  )
}
