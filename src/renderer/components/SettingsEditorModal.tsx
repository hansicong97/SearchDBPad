/**
 * Settings edit modal (V0.3.2 A-2).
 *
 * Monaco-based JSON editor for the index's `index.*` settings.
 * Mirrors the DslQueryPanel approach: same `monacoEnv` import,
 * same JSON validity Tag, and a 「格式化」 button so the user can
 * tidy up pasted JSON before submitting.
 *
 * Static settings (e.g. `number_of_shards`) will be rejected by
 * Elasticsearch and the error surfaces from the IPC layer verbatim
 * — we deliberately do NOT pre-validate "dynamic vs static" on the
 * client because that list drifts across ES majors. The hint line
 * at the top of the modal is the only guidance we give.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Modal,
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
// the editor is rendered, identical to DslQueryPanel.
import './monacoEnv'

const { Text, Paragraph } = Typography

const DEFAULT_SETTINGS = '{}'

interface Props {
  open: boolean
  indexName: string
  onClose: () => void
}

export default function SettingsEditorModal({
  open,
  indexName,
  onClose
}: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const settings = useWorkspaceStore((s) => s.settings)
  const updateIndexSettings = useWorkspaceStore((s) => s.updateIndexSettings)
  const fetchSettings = useWorkspaceStore((s) => s.fetchSettings)

  const [text, setText] = useState<string>(DEFAULT_SETTINGS)
  const [submitting, setSubmitting] = useState(false)

  // Re-seed the editor each time it opens so a stale draft from a
  // previous open cannot overwrite new server values. The settings
  // payload looks like `{ "<index>": { "settings": { "index": { ... } } } }`
  // — we pull out the inner block so the user edits the canonical
  // `index.*` shape directly.
  useEffect(() => {
    if (!open) return
    if (!settings || typeof settings !== 'object') {
      setText(DEFAULT_SETTINGS)
      return
    }
    const block = settings[indexName]
    const inner =
      block && typeof block === 'object'
        ? (block as Record<string, unknown>).settings
        : undefined
    const indexBlock =
      inner && typeof inner === 'object' && 'index' in (inner as object)
        ? (inner as Record<string, unknown>).index
        : undefined
    const seed =
      indexBlock && typeof indexBlock === 'object'
        ? JSON.stringify(indexBlock, null, 2)
        : DEFAULT_SETTINGS
    setText(seed)
  }, [open, settings, indexName])

  /** Live validity tag — Monaco itself flags errors inline, but the
   *  same Tag as DslQueryPanel keeps the toolbar honest about
   *  whether submit will succeed. */
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
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      message.error(`JSON 解析失败：${(err as Error).message}`)
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      message.error('Settings 必须是 JSON 对象')
      return
    }
    setSubmitting(true)
    try {
      // ES expects `{ index: { ... } }` shape; the editor already
      // shows that inner block, so wrap it back here.
      const settingsBody: Record<string, unknown> = { index: parsed }
      const res = await updateIndexSettings({
        connectionId: activeConnectionId,
        index: indexName,
        settings: settingsBody
      })
      if (res?.success) {
        message.success(`已更新索引 "${indexName}" 的动态 Settings`)
        // Force-refetch in case the cached `settings` payload in the
        // store predates the update.
        await fetchSettings(activeConnectionId, indexName)
        onClose()
      } else if (res) {
        message.error(
          `更新失败：${res.error?.message ?? '未知错误'}`
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={`编辑 Settings · ${indexName}`}
      onCancel={submitting ? undefined : onClose}
      width={760}
      destroyOnClose
      footer={
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
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="编辑 `index.*` 动态 Settings"
          description={
            <Paragraph style={{ marginBottom: 0 }}>
              仅支持修改 ES 动态 settings（如 <code>refresh_interval</code>、
              <code>number_of_replicas</code>）。静态 settings（如
              <code>number_of_shards</code>）会被服务端拒绝，错误信息会原样展示。
              文案内容将以 <Text code>{"{ index: { ... } }"}</Text> 的形式提交。
            </Paragraph>
          }
        />
        <Space size="small">
          <Button
            size="small"
            icon={<CheckCircleOutlined />}
            onClick={handleFormat}
          >
            格式化
          </Button>
          <Tag color={isValidJson ? 'success' : 'error'} style={{ margin: 0 }}>
            {isValidJson ? 'JSON 合法' : 'JSON 不合法'}
          </Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            · 编辑器内容会以 <Text code>{"{ index: { ... } }"}</Text> 提交
          </Text>
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
                wordWrap: 'on'
              }}
              loading={<CodeOutlined />}
            />
          </div>
        </Spin>
      </Space>
    </Modal>
  )
}
