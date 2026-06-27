/**
 * Mapping edit modal (V0.3.3 A-3).
 *
 * Monaco-based JSON editor for adding NEW fields to an existing
 * index mapping. Mirrors `SettingsEditorModal` / `DslQueryPanel`:
 * same `monacoEnv` import, same JSON validity Tag, same 「格式化」
 * button. The editor seeds the current `properties` block so the
 * user can see what already exists, but they are expected to only
 * append — modifying an existing field's type is rejected by ES.
 *
 * The renderer only edits the inner `properties` object so the
 * adapter can take care of ES 6.x `_doc` wrapping (see
 * `versionCompat.ts`).
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
  PlusOutlined
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import { useWorkspaceStore } from '../stores/workspace.store'

// Side-effect import — wires Monaco workers + loader config before
// the editor is rendered, identical to DslQueryPanel.
import './monacoEnv'

const { Text, Paragraph } = Typography

const DEFAULT_PROPERTIES = '{\n  \n}'

interface Props {
  open: boolean
  indexName: string
  onClose: () => void
}

export default function MappingEditorModal({
  open,
  indexName,
  onClose
}: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const mapping = useWorkspaceStore((s) => s.mapping)
  const updateIndexMapping = useWorkspaceStore((s) => s.updateIndexMapping)
  const fetchMapping = useWorkspaceStore((s) => s.fetchMapping)

  const [text, setText] = useState<string>(DEFAULT_PROPERTIES)
  const [submitting, setSubmitting] = useState(false)

  // Re-seed each time the modal opens so a stale draft cannot
  // overwrite new server-side fields. The mapping payload has the
  // shape `{ "<index>": { "mappings": { "properties": {...} } } }`
  // for ES 7+, or `{ "<index>": { "mappings": { "_doc": { ... } } } }`
  // for ES 6.x. We strip the `_doc` wrapper so the renderer always
  // edits the canonical `{ properties: {...} }` shape.
  useEffect(() => {
    if (!open) return
    if (!mapping || typeof mapping !== 'object') {
      setText(DEFAULT_PROPERTIES)
      return
    }
    const block = mapping[indexName]
    const innerMappings =
      block && typeof block === 'object'
        ? (block as Record<string, unknown>).mappings
        : undefined
    const inner =
      innerMappings && typeof innerMappings === 'object'
        ? '_doc' in (innerMappings as object)
          ? (innerMappings as Record<string, unknown>)._doc
          : innerMappings
        : undefined
    const properties =
      inner && typeof inner === 'object' && 'properties' in (inner as object)
        ? (inner as Record<string, unknown>).properties
        : undefined
    const seed =
      properties && typeof properties === 'object'
        ? JSON.stringify(properties, null, 2)
        : DEFAULT_PROPERTIES
    setText(seed)
  }, [open, mapping, indexName])

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
      message.error('Mapping properties 必须是 JSON 对象')
      return
    }
    setSubmitting(true)
    try {
      // We deliberately forward ONLY `{ properties: {...} }`. The
      // adapter wraps that under `_doc` for ES 6.x and passes it
      // straight through for ES 7+.
      const mappingBody: Record<string, unknown> = { properties: parsed }
      const res = await updateIndexMapping({
        connectionId: activeConnectionId,
        index: indexName,
        mapping: mappingBody
      })
      if (res?.success) {
        message.success(`已追加索引 "${indexName}" 的 Mapping 字段`)
        // Force-refetch in case the cached `mapping` payload in the
        // store predates the update.
        await fetchMapping(activeConnectionId, indexName)
        onClose()
      } else if (res) {
        message.error(
          `追加失败：${res.error?.message ?? '未知错误'}`
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={`追加 Mapping · ${indexName}`}
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
            icon={<PlusOutlined />}
            onClick={() => void handleSubmit()}
            loading={submitting}
            disabled={!isValidJson}
          >
            追加字段
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          message="仅支持追加字段"
          description={
            <Paragraph style={{ marginBottom: 0 }}>
              V0.3.3 只允许添加新的 mapping 字段定义。修改已有字段的类型会被
              Elasticsearch 拒绝（<Text code>illegal_argument_exception</Text>），
              错误信息会原样展示。ES 6.x 集群的 mapping 会由 adapter 自动包
              <Text code>{'{ _doc: { properties: ... } }'}</Text>。
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
            · 编辑器内容为 <Text code>properties</Text> 子块，会以
            <Text code>{' { properties: { ... } }'}</Text> 提交
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
