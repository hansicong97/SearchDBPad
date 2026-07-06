/**
 * Create index modal (phase 13 + V0.3.10 F-3).
 *
 * Modal opened from the index list's "新建索引" button. Lets the user
 * create a new index with:
 *   - index name (required)
 *   - settings JSON (optional)
 *   - mappings JSON (optional)
 *
 * V0.3.10 F-3 changes (revised):
 *   - The modal no longer touches the import path. On success it
 *     hands the new index name to the caller with one of two
 *     intents:
 *       * `{ tab: 'documents' }`  — land on the default 文档 tab
 *                                  after closing the modal
 *       * `{ tab: 'import' }`     — close the modal and jump
 *                                  straight to the new index's
 *                                  导入 tab. The user picks the
 *                                  file from ImportPanel — we do
 *                                  NOT pre-fill it. This keeps
 *                                  ImportPanel as the single
 *                                  "import data" entry point.
 *   - The modal footer has three buttons: 取消 / 完成 /
 *     导入数据. The first two are the same action; 导入数据
 *     picks a different landing tab. Both commit actions share
 *     the same readiness check (name + valid settings / mapping).
 *   - The "创建后导入数据" Switch and the embedded file / format
 *     block are gone — they're replaced by the explicit button.
 *   - Pick-file is no longer called from the modal.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AutoComplete,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Typography
} from 'antd'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { IndexDetailTabKey } from '../stores/workspace.store'

const { Text } = Typography

interface Props {
  open: boolean
  onClose: () => void
  /** Called with the new index name after the create step
   *  succeeds. The second argument is the landing tab the
   *  caller should select: either `'documents'` (the
   *  default, used by the 完成 button) or `'import'` (used
   *  by the 导入数据 button). The modal no longer executes
   *  the import — ImportPanel remains the single
   *  import-data entry point and the user picks the file
   *  there. */
  onCreated: (indexName: string, intent?: { tab: IndexDetailTabKey }) => void
}

export default function CreateIndexModal({
  open,
  onClose,
  onCreated
}: Props): JSX.Element {
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const indexList = useWorkspaceStore((s) => s.indices)
  const createIndex = useWorkspaceStore((s) => s.createIndex)

  const [name, setName] = useState('')
  const [settingsText, setSettingsText] = useState('')
  const [mappingsText, setMappingsText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset every time the modal opens.
  useEffect(() => {
    if (open) {
      setName('')
      setSettingsText('')
      setMappingsText('')
      setErrorMsg(null)
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
    return true
  }, [activeConnectionId, name, settingsError, mappingsError])

  /* V0.3.10 F-3 (revised): the modal no longer handles file picks.
   *  Both commit buttons go through the same create + intent path;
   *  the only difference is which tab the caller should land on
   *  after the modal closes. */
  const handleSubmit = async (
    intent: { tab: IndexDetailTabKey }
  ): Promise<void> => {
    if (!ready || !activeConnectionId) return
    setErrorMsg(null)
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
      onCreated(name.trim(), intent)
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
            onClick={() => void handleSubmit({ tab: 'documents' })}
            loading={submitting}
            disabled={!ready}
          >
            完成
          </Button>
          <Button
            type="primary"
            onClick={() => void handleSubmit({ tab: 'import' })}
            loading={submitting}
            disabled={!ready}
          >
            导入数据
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

        {errorMsg ? (
          <Alert
            type="warning"
            showIcon
            message="提示"
            description={errorMsg}
            style={{ marginTop: 8 }}
          />
        ) : null}
      </Form>
    </Modal>
  )
}
