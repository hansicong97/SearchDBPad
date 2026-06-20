/**
 * Create index modal (phase 13).
 *
 * Modal opened from the index list's "新建索引" button. Lets the user
 * create a new index with:
 *   - index name (required)
 *   - settings JSON (optional)
 *   - mappings JSON (optional)
 *
 * Per the version update plan, this modal also supports creating the
 * index AND importing data from a file in a single flow. The file-
 * picker / format / mode block is rendered when the user toggles
 * "创建后导入数据". Submission is split into a two-step IPC chain:
 *   1. `index:create`  (always)
 *   2. `import:execute` (only if the toggle is on and a file is picked)
 *
 * The 覆盖 (replace) mode is only available for the import into an
 * EXISTING index. When we're importing into a freshly created index
 * the user has not yet had a chance to put data in it, so we collapse
 * 追加/覆盖 to just 追加.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  Collapse,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Typography
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import type {
  ImportExecuteResult,
  ImportFormat,
  ImportMode
} from '@shared/ipc'

const { Text, Paragraph } = Typography

interface Props {
  open: boolean
  onClose: () => void
  /** Called with the new index name after the create step succeeds.
   *  The create-and-import step (if any) is in flight at this point —
   *  the caller can show a spinner or stay on the modal, depending on
   *  UX. */
  onCreated: (indexName: string) => void
}

/** Strip the path off a `file://` / Windows path the user pasted. We
 *  ask the OS to pick files via the main process, so the renderer only
 *  ever holds a plain filesystem path. */
function fileBaseName(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const last = norm.split('/').pop() ?? p
  return last
}

export default function CreateIndexModal({
  open,
  onClose,
  onCreated
}: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const indexList = useWorkspaceStore((s) => s.indices)
  const createIndex = useWorkspaceStore((s) => s.createIndex)
  const importDoc = useWorkspaceStore((s) => s.runImport)

  const [name, setName] = useState('')
  const [settingsText, setSettingsText] = useState('')
  const [mappingsText, setMappingsText] = useState('')
  const [importEnabled, setImportEnabled] = useState(false)
  const [pickedFile, setPickedFile] = useState<{
    filePath: string
    format: ImportFormat
  } | null>(null)
  const [format, setFormat] = useState<ImportFormat>('auto')
  const [mode, setMode] = useState<ImportMode>('append')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportExecuteResult | null>(
    null
  )

  // Reset every time the modal opens.
  useEffect(() => {
    if (open) {
      setName('')
      setSettingsText('')
      setMappingsText('')
      setImportEnabled(false)
      setPickedFile(null)
      setFormat('auto')
      setMode('append')
      setErrorMsg(null)
      setImportResult(null)
    }
  }, [open])

  const indexSuggestions = useMemo(
    () => indexList.map((i) => ({ value: i.index })),
    [indexList]
  )

  const settingsError = useMemo<string | null>(() => {
    if (!settingsText.trim()) return null
    try {
      JSON.parse(settingsText)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }, [settingsText])

  const mappingsError = useMemo<string | null>(() => {
    if (!mappingsText.trim()) return null
    try {
      JSON.parse(mappingsText)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }, [mappingsText])

  const ready = useMemo(() => {
    if (!activeConnectionId) return false
    if (!name.trim()) return false
    if (settingsError || mappingsError) return false
    if (importEnabled && !pickedFile) return false
    return true
  }, [activeConnectionId, name, settingsError, mappingsError, importEnabled, pickedFile])

  const handlePickFile = async (): Promise<void> => {
    if (!activeConnectionId) return
    const res = await window.esApi.importDocs.pickFile({
      format: 'json'
    })
    if (!res.success || !res.data) {
      message.error(res.error?.message ?? '打开文件对话框失败')
      return
    }
    if (res.data.filePath === null || res.data.format === null) {
      // User cancelled — silent.
      return
    }
    setPickedFile({ filePath: res.data.filePath, format: res.data.format })
    // If the user hasn't picked a format yet, mirror the extension
    // hint into the format selector so the preview/execute uses the
    // inferred format.
    if (format === 'auto') {
      setFormat(res.data.format)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    if (!ready || !activeConnectionId) return
    setErrorMsg(null)
    setImportResult(null)
    setSubmitting(true)
    try {
      const settings = settingsText.trim()
        ? (JSON.parse(settingsText) as Record<string, unknown>)
        : undefined
      const mappings = mappingsText.trim()
        ? (JSON.parse(mappingsText) as Record<string, unknown>)
        : undefined
      const createRes = await createIndex({
        connectionId: activeConnectionId,
        index: name.trim(),
        settings,
        mappings
      })
      if (!createRes || !createRes.success) {
        setErrorMsg(createRes?.error?.message ?? '创建索引失败')
        return
      }
      onCreated(name.trim())
      if (importEnabled && pickedFile) {
        // The freshly-created index is empty, so `replace` is equivalent
        // to `append` — the plan says we must not silently coerce this
        // for existing indices, but the UI only offers 追加 here.
        const res = await importDoc({
          connectionId: activeConnectionId,
          index: name.trim(),
          filePath: pickedFile.filePath,
          format,
          mode
        })
        if (!res || !res.success || !res.data) {
          setErrorMsg(
            `索引已创建，但导入失败：${res?.error?.message ?? '未知错误'}`
          )
          return
        }
        setImportResult(res.data)
        const r = res.data
        if (r.failed === 0) {
          message.success(`已创建索引并导入 ${r.success} 条`)
        } else if (r.success === 0) {
          message.error(`导入失败：${r.failed} 条全部失败`)
        } else {
          message.warning(`部分导入：成功 ${r.success}，失败 ${r.failed}`)
        }
      } else {
        message.success(`已创建索引 "${name.trim()}"`)
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="新建索引"
      open={open}
      onCancel={onClose}
      width={680}
      destroyOnClose
      maskClosable={false}
      footer={
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="primary"
            onClick={() => void handleSubmit()}
            loading={submitting}
            disabled={!ready}
          >
            创建
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" disabled={submitting}>
        <Form.Item
          label="索引名称"
          required
          help="必须以小写字母开头，只能包含小写字母、数字、_、-、+。ES 自动创建索引时禁用。"
        >
          <AutoComplete
            value={name}
            onChange={(v) => setName(v)}
            options={indexSuggestions}
            placeholder="例如：users-2026"
            filterOption={(input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
            }
            allowClear
          >
            <Input />
          </AutoComplete>
        </Form.Item>

        <Form.Item
          label={
            <Space>
              <Text>Settings JSON</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                (可选)
              </Text>
            </Space>
          }
          validateStatus={settingsError ? 'error' : undefined}
          help={settingsError ? `Settings 解析失败：${settingsError}` : undefined}
        >
          <Input.TextArea
            value={settingsText}
            onChange={(e) => setSettingsText(e.target.value)}
            placeholder='例如：{ "number_of_shards": 1, "number_of_replicas": 1 }'
            autoSize={{ minRows: 3, maxRows: 8 }}
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              <Text>Mapping JSON</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                (可选)
              </Text>
            </Space>
          }
          validateStatus={mappingsError ? 'error' : undefined}
          help={mappingsError ? `Mapping 解析失败：${mappingsError}` : undefined}
        >
          <Input.TextArea
            value={mappingsText}
            onChange={(e) => setMappingsText(e.target.value)}
            placeholder='例如：{ "properties": { "name": { "type": "text" } } }'
            autoSize={{ minRows: 3, maxRows: 8 }}
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>

        <Form.Item>
          <Space>
            <Switch
              checked={importEnabled}
              onChange={setImportEnabled}
              size="small"
            />
            <Text>创建后导入数据</Text>
          </Space>
        </Form.Item>

        {importEnabled ? (
          <div
            style={{
              border: '1px dashed var(--ant-color-border)',
              borderRadius: 6,
              padding: 12,
              background: 'var(--ant-color-bg-layout)'
            }}
          >
            <Form.Item label="文件" required>
              <Space>
                <Button icon={<FileTextOutlined />} onClick={() => void handlePickFile()}>
                  选择文件
                </Button>
                {pickedFile ? (
                  <Space size={4}>
                    <Text code>{fileBaseName(pickedFile.filePath)}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      路径：{pickedFile.filePath}
                    </Text>
                  </Space>
                ) : (
                  <Text type="secondary">未选择</Text>
                )}
              </Space>
            </Form.Item>

            <Form.Item label="导入格式">
              <Select
                value={format}
                onChange={(v) => setFormat(v)}
                style={{ width: 200 }}
                options={[
                  { value: 'auto', label: '自动识别' },
                  { value: 'json', label: 'JSON' },
                  { value: 'ndjson', label: 'NDJSON' },
                  { value: 'csv', label: 'CSV' }
                ]}
              />
            </Form.Item>

            <Form.Item label="导入模式">
              <Radio.Group
                value={mode}
                onChange={(e) => setMode(e.target.value as ImportMode)}
              >
                <Space direction="vertical" size={2}>
                  <Radio value="append">
                    <Space size={4}>
                      <Text>追加</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        (写入新建的空索引)
                      </Text>
                    </Space>
                  </Radio>
                  <Radio value="replace" disabled>
                    <Space size={4}>
                      <Text>覆盖</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        (新建索引场景不可用，先清空再写入)
                      </Text>
                    </Space>
                  </Radio>
                </Space>
              </Radio.Group>
            </Form.Item>
          </div>
        ) : null}

        {errorMsg ? (
          <Alert
            type="warning"
            showIcon
            message="提示"
            description={errorMsg}
            style={{ marginTop: 8 }}
          />
        ) : null}

        {importResult ? (
          <Alert
            type={
              importResult.failed === 0
                ? 'success'
                : importResult.success === 0
                ? 'error'
                : 'warning'
            }
            showIcon
            icon={
              importResult.failed === 0 ? (
                <CheckCircleOutlined />
              ) : (
                <CloseCircleOutlined />
              )
            }
            message="导入结果"
            description={
              <Space direction="vertical" size={4}>
                <Text>
                  总计 <Text strong>{importResult.total.toLocaleString('en-US')}</Text> ·
                  成功 <Text type="success" strong>{importResult.success.toLocaleString('en-US')}</Text> ·
                  失败 <Text type="danger" strong>{importResult.failed.toLocaleString('en-US')}</Text>
                </Text>
                {importResult.failed > 0 ? (
                  <Collapse
                    ghost
                    items={[
                      {
                        key: 'f',
                        label: <Text type="danger">失败详情</Text>,
                        children: (
                          <Paragraph
                            copyable
                            style={{
                              maxHeight: 200,
                              overflow: 'auto',
                              marginBottom: 0,
                              fontSize: 12
                            }}
                          >
                            {importResult.failures
                              .map(
                                (f) =>
                                  `行 ${f.line + 1}${f.id ? ` (_id=${f.id})` : ''}: ${f.error}`
                              )
                              .join('\n')}
                          </Paragraph>
                        )
                      }
                    ]}
                  />
                ) : null}
              </Space>
            }
            style={{ marginTop: 8 }}
          />
        ) : null}
      </Form>
    </Modal>
  )
}
