/**
 * Document editor modal (phase 7).
 *
 * Shared modal for creating and editing a single document. Drives a
 * Monaco JSON editor for the `_source` body, plus an optional `_id`
 * input in create mode. Submits through the workspace store, which
 * forwards to `document:create` / `document:update` and refreshes the
 * browse tab on success.
 *
 * The modal is owned by `DocumentPanel`, which already has the context
 * (active connection + selected index) needed to populate the request.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Typography
} from 'antd'
import {
  CheckCircleOutlined,
  SaveOutlined,
  PlusOutlined
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { DocumentHit } from '@shared/ipc'
// Side-effect import — wires Monaco workers + loader config before the
// editor mounts. Safe to import multiple times.
import './monacoEnv'

const { Text } = Typography

const EMPTY_SOURCE = '{}\n'

export type DocumentEditorMode = 'create' | 'edit'

export interface DocumentEditorModalProps {
  open: boolean
  mode: DocumentEditorMode
  indexName: string
  /** Required when mode === 'edit'. */
  hit?: DocumentHit | null
  onClose: () => void
}

export default function DocumentEditorModal({
  open,
  mode,
  indexName,
  hit,
  onClose
}: DocumentEditorModalProps): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const createDocument = useWorkspaceStore((s) => s.createDocument)
  const updateDocument = useWorkspaceStore((s) => s.updateDocument)

  const [docId, setDocId] = useState<string>('')
  const [content, setContent] = useState<string>(EMPTY_SOURCE)
  const [parseError, setParseError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)

  /** True only when the editor content parses as a JSON object (ES
   *  rejects arrays / scalars at the top level). */
  const validation = useMemo<
    { ok: boolean; error: string | null; parsed: Record<string, unknown> | null }
  >(() => {
    try {
      const parsed = JSON.parse(content) as unknown
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return { ok: false, error: 'JSON 顶层必须是对象', parsed: null }
      }
      return { ok: true, error: null, parsed: parsed as Record<string, unknown> }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        parsed: null
      }
    }
  }, [content])

  // Reset state whenever the modal opens or its target switches between
  // create / edit / different docs.
  useEffect(() => {
    if (!open) return
    setSubmitError(null)
    setParseError(null)
    if (mode === 'edit' && hit) {
      setDocId(hit._id)
      try {
        setContent(JSON.stringify(hit._source ?? {}, null, 2))
      } catch {
        setContent(EMPTY_SOURCE)
      }
    } else {
      setDocId('')
      setContent(EMPTY_SOURCE)
    }
    setSubmitting(false)
  }, [open, mode, hit])

  const handleFormat = (): void => {
    if (!validation.ok && validation.parsed === null) {
      setParseError(validation.error)
      message.error(`JSON 不合法：${validation.error}`)
      return
    }
    setContent(JSON.stringify(validation.parsed ?? {}, null, 2))
    setParseError(null)
  }

  const handleSubmit = async (): Promise<void> => {
    if (!activeConnectionId) {
      setSubmitError('当前没有可用连接')
      return
    }
    if (!validation.ok || !validation.parsed) {
      setParseError(validation.error)
      return
    }
    setParseError(null)
    setSubmitting(true)
    setSubmitError(null)
    const trimmedId = docId.trim()
    const res =
      mode === 'create'
        ? await createDocument({
            connectionId: activeConnectionId,
            index: indexName,
            id: trimmedId === '' ? undefined : trimmedId,
            source: validation.parsed
          })
        : await updateDocument({
            connectionId: activeConnectionId,
            index: indexName,
            id: trimmedId,
            source: validation.parsed
          })
    setSubmitting(false)
    // The store may have dropped the response because the user switched
    // index mid-call — close silently in that case.
    if (res === null) {
      onClose()
      return
    }
    if (res.success && res.data) {
      message.success(
        mode === 'create'
          ? `已创建文档 _id=${res.data.id}`
          : `已更新文档 _id=${res.data.id}`
      )
      onClose()
    } else {
      setSubmitError(res.error?.message ?? '提交失败')
    }
  }

  const title =
    mode === 'create'
      ? `新建文档 · ${indexName}`
      : `编辑文档 · ${indexName} · _id=${hit?._id ?? docId}`

  const submitDisabled = !validation.ok || submitting
  const idEditable = mode === 'create'

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      width={760}
      destroyOnClose
      maskClosable={false}
      footer={
        <Space>
          <Button
            icon={<CheckCircleOutlined />}
            onClick={handleFormat}
            disabled={submitting}
          >
            格式化
          </Button>
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="primary"
            icon={mode === 'create' ? <PlusOutlined /> : <SaveOutlined />}
            onClick={() => void handleSubmit()}
            loading={submitting}
            disabled={submitDisabled}
          >
            {mode === 'create' ? '提交新增' : '保存修改'}
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item
          label={
            <Space size={4}>
              <Text>_id</Text>
              {mode === 'create' ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  (可选；留空时由 Elasticsearch 自动生成)
                </Text>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  (编辑模式下不可修改)
                </Text>
              )}
            </Space>
          }
        >
          <Input
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            disabled={!idEditable}
            placeholder={mode === 'create' ? '留空自动生成' : ''}
            allowClear={idEditable}
          />
        </Form.Item>

        <Form.Item
          label={
            <Space size={4}>
              <Text>_source</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                (JSON 对象，提交前会校验)
              </Text>
            </Space>
          }
          required
          validateStatus={parseError ? 'error' : validation.ok ? 'success' : ''}
          help={parseError ?? undefined}
        >
          <div
            style={{
              border: '1px solid var(--ant-color-border)',
              borderRadius: 4,
              overflow: 'hidden',
              background: '#1e1e1e'
            }}
          >
            <Editor
              height="320px"
              defaultLanguage="json"
              value={content}
              theme="vs-dark"
              onChange={(v) => setContent(v ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                tabSize: 2,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                renderLineHighlight: 'gutter',
                wordWrap: 'on'
              }}
            />
          </div>
        </Form.Item>

        {parseError ? (
          <Alert
            type="error"
            showIcon
            message="JSON 校验失败"
            description={parseError}
            style={{ marginBottom: 12 }}
          />
        ) : null}

        {submitError ? (
          <Alert
            type="error"
            showIcon
            message={mode === 'create' ? '创建失败' : '保存失败'}
            description={submitError}
          />
        ) : null}
      </Form>
    </Modal>
  )
}