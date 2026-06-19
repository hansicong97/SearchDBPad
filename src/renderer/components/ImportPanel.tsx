/**
 * Import panel (phase 9).
 *
 * Tab content for the 导入 entry in `IndexDetailPanel`. Lets the user
 * pick a JSON / NDJSON / CSV file, preview the first 10 rows, and
 * bulk-insert them into the selected index via the OS + ES Bulk API.
 *
 * The MVP:
 *   - format is auto-detected from the file extension (JSON / NDJSON /
 *     CSV). No manual override.
 *   - target index defaults to the currently-selected index in the
 *     workspace store. The user can switch the index inline.
 *   - CSV cells are all coerced to strings (per the phase 9 spec).
 *   - bulk responses are aggregated; first 20 failures are surfaced
 *     in a collapsible detail list.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  ImportOutlined
} from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import type {
  ImportExecuteResult,
  ImportFailure,
  ImportFormat,
  ImportPreviewResult,
  ImportPreviewRow
} from '@shared/ipc'

const { Text, Paragraph } = Typography

const PREVIEW_ROW_COUNT = 10

/** Render a JSON-ish value in a compact `<pre>` cell. Matches the
 *  document-table style from `DocumentPanel.tsx`. */
function SourceCell({ value }: { value: Record<string, unknown> }): JSX.Element {
  let pretty: string
  try {
    pretty = JSON.stringify(value, null, 2)
  } catch {
    pretty = String(value)
  }
  return (
    <pre
      style={{
        background: '#fafafa',
        border: '1px solid #f0f0f0',
        borderRadius: 4,
        padding: 8,
        margin: 0,
        maxHeight: 160,
        overflow: 'auto',
        fontSize: 12,
        lineHeight: 1.5,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        whiteSpace: 'pre'
      }}
    >
      {pretty}
    </pre>
  )
}

export default function ImportPanel(): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const selectedIndex = useWorkspaceStore((s) => s.selectedIndex)
  const indexList = useWorkspaceStore((s) => s.indices)
  const refreshDocumentPage = useWorkspaceStore((s) => s.refreshDocumentPage)

  const [targetIndex, setTargetIndex] = useState<string>(selectedIndex ?? '')
  const [pickedFile, setPickedFile] = useState<{
    filePath: string
    format: ImportFormat
  } | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState<boolean>(false)
  const [result, setResult] = useState<ImportExecuteResult | null>(null)
  const [importing, setImporting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Keep the target index in sync when the workspace's selected index
  // changes (e.g. user picks another index in the sidebar), unless the
  // user has already started configuring an import.
  useEffect(() => {
    if (!pickedFile && !result) {
      setTargetIndex(selectedIndex ?? '')
    }
  }, [selectedIndex, pickedFile, result])

  const ready = !!activeConnectionId && !!targetIndex && !!pickedFile

  const indexSuggestions = useMemo(
    () => indexList.map((i) => ({ value: i.index })),
    [indexList]
  )

  const handlePick = async (): Promise<void> => {
    setErrorMsg(null)
    setResult(null)
    setPreview(null)
    setPickedFile(null)
    const res = await window.esApi.importDocs.pickFile({
      format: 'json'
    })
    if (!res.success || !res.data) {
      setErrorMsg(res.error?.message ?? '打开文件对话框失败')
      return
    }
    if (res.data.filePath === null || res.data.format === null) {
      // User cancelled — silent no-op.
      return
    }
    setPickedFile({ filePath: res.data.filePath, format: res.data.format })
  }

  const handlePreview = async (): Promise<void> => {
    if (!pickedFile) return
    setErrorMsg(null)
    setResult(null)
    setPreview(null)
    setPreviewLoading(true)
    try {
      const res = await window.esApi.importDocs.preview({
        filePath: pickedFile.filePath,
        format: pickedFile.format,
        maxRows: PREVIEW_ROW_COUNT
      })
      if (!res.success || !res.data) {
        setErrorMsg(res.error?.message ?? '预览失败')
        return
      }
      setPreview(res.data)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleExecute = async (): Promise<void> => {
    if (!ready || !pickedFile || !activeConnectionId) return
    setErrorMsg(null)
    setResult(null)
    setImporting(true)
    try {
      const res = await window.esApi.importDocs.execute({
        connectionId: activeConnectionId,
        index: targetIndex,
        filePath: pickedFile.filePath,
        format: pickedFile.format
      })
      if (!res.success || !res.data) {
        setErrorMsg(res.error?.message ?? '导入失败')
        return
      }
      setResult(res.data)
      const r = res.data
      if (r.failed === 0) {
        message.success(`已导入 ${r.success} 条到 ${r.index}`)
      } else if (r.success === 0) {
        message.error(`导入失败：${r.failed} 条全部失败`)
      } else {
        message.warning(`部分导入：成功 ${r.success}，失败 ${r.failed}`)
      }
      // If the import landed in the index the user is currently
      // browsing, refresh that page so they see the new docs without
      // a manual reload. The store's race guard makes this safe even if
      // the user switches index before the request returns.
      if (activeConnectionId && r.index === selectedIndex) {
        void refreshDocumentPage()
      }
    } finally {
      setImporting(false)
    }
  }

  const previewColumns = [
    {
      title: '行号',
      key: 'line',
      width: 70,
      render: (_v: unknown, _r: ImportPreviewRow, idx: number) => idx + 1
    },
    {
      title: '_id',
      dataIndex: 'id',
      key: 'id',
      width: 200,
      render: (v: string | undefined) =>
        v === undefined ? (
          <Text type="secondary">（自动生成）</Text>
        ) : (
          <Text strong>{v}</Text>
        )
    },
    {
      title: '_source',
      dataIndex: 'source',
      key: 'source',
      render: (_v: unknown, record: ImportPreviewRow) => (
        <SourceCell value={record.source} />
      )
    }
  ]

  const failureColumns = [
    {
      title: '行号',
      dataIndex: 'line',
      key: 'line',
      width: 70,
      render: (v: number) => v + 1
    },
    {
      title: '_id',
      dataIndex: 'id',
      key: 'id',
      width: 160,
      render: (v: string | undefined) =>
        v ?? <Text type="secondary">-</Text>
    },
    {
      title: '错误',
      dataIndex: 'error',
      key: 'error'
    }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small" title="导入设置">
        <Form layout="vertical" disabled={importing}>
          <Form.Item label="目标索引" required>
            <AutoComplete
              value={targetIndex}
              onChange={(v) => setTargetIndex(v)}
              options={indexSuggestions}
              placeholder="选择已有索引或输入新名称"
              filterOption={(input, option) =>
                (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
              }
              style={{ width: 360 }}
              allowClear
            >
              <Input />
            </AutoComplete>
          </Form.Item>

          <Form.Item label="文件" required>
            <Space>
              <Button icon={<FileTextOutlined />} onClick={() => void handlePick()}>
                选择文件
              </Button>
              {pickedFile ? (
                <Space size={4}>
                  <Text code>{pickedFile.filePath}</Text>
                  <Tag color="blue">{pickedFile.format.toUpperCase()}</Tag>
                </Space>
              ) : (
                <Text type="secondary">未选择</Text>
              )}
            </Space>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                icon={<FileTextOutlined />}
                onClick={() => void handlePreview()}
                loading={previewLoading}
                disabled={!pickedFile}
              >
                预览前 {PREVIEW_ROW_COUNT} 条
              </Button>
              <Button
                type="primary"
                icon={<ImportOutlined />}
                onClick={() => void handleExecute()}
                loading={importing}
                disabled={!ready}
              >
                导入到 "{targetIndex || '(未填)'}"
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {errorMsg ? (
        <Alert
          type="error"
          showIcon
          message="导入失败"
          description={errorMsg}
        />
      ) : null}

      {preview && preview.warnings.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="格式提示"
          description={
            <Space direction="vertical" size={2}>
              {preview.warnings.map((w, i) => (
                <Text key={i}>· {w}</Text>
              ))}
            </Space>
          }
        />
      ) : null}

      {preview ? (
        <Card
          size="small"
          title={
            <Space>
              <Text>预览（前 {preview.rows.length} / 共 {preview.totalRows} 条）</Text>
              <Tag color="blue">{preview.format.toUpperCase()}</Tag>
            </Space>
          }
        >
          <Table<ImportPreviewRow>
            rowKey={(_r, idx) => String(idx)}
            columns={previewColumns}
            dataSource={preview.rows}
            size="small"
            pagination={false}
            locale={{ emptyText: '文件为空或无可预览行' }}
          />
        </Card>
      ) : null}

      {result ? (
        <Card
          size="small"
          title={
            <Space>
              {result.failed === 0 ? (
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
              ) : result.success === 0 ? (
                <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
              ) : (
                <CloseCircleOutlined style={{ color: '#faad14' }} />
              )}
              <Text>导入结果</Text>
            </Space>
          }
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space size="large">
              <Text>
                总计 <Text strong>{result.total.toLocaleString('en-US')}</Text> 条
              </Text>
              <Text type="success">
                成功 <Text strong>{result.success.toLocaleString('en-US')}</Text>
              </Text>
              <Text type={result.failed > 0 ? 'danger' : 'secondary'}>
                失败 <Text strong>{result.failed.toLocaleString('en-US')}</Text>
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                索引：<Text code>{result.index}</Text>
              </Text>
            </Space>
            {result.failed > 0 ? (
              <Collapse
                ghost
                items={[
                  {
                    key: 'failures',
                    label: (
                      <Text type="danger">
                        {result.failures.length >= 20
                          ? `前 ${result.failures.length} 条失败（可能还有更多）`
                          : `${result.failures.length} 条失败详情`}
                      </Text>
                    ),
                    children: (
                      <Table<ImportFailure>
                        rowKey={(_r, idx) => String(idx)}
                        columns={failureColumns}
                        dataSource={result.failures}
                        size="small"
                        pagination={false}
                      />
                    )
                  }
                ]}
              />
            ) : (
              <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                没有失败项。
              </Paragraph>
            )}
          </Space>
        </Card>
      ) : null}
    </div>
  )
}