/**
 * Import panel (phase 9 + 13).
 *
 * Tab content for the 导入 entry in `IndexDetailPanel`. Lets the user
 * pick a JSON / NDJSON / CSV file, preview the first 10 rows, and
 * bulk-insert them into the selected index via the OS + ES Bulk API.
 *
 * Phase 13 (version update plan):
 *   - The user can explicitly choose the source format (自动 / JSON /
 *     NDJSON / CSV). `自动` infers from the file extension; the
 *     explicit choice wins if set.
 *   - The user can pick the import mode (追加 / 覆盖). 覆盖 wipes the
 *     target index's docs first via `_delete_by_query` and requires
 *     a second confirmation.
 *   - On success the renderer's workspace store refreshes the current
 *     document browse page when the target index matches.
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
  Progress,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  ImportOutlined,
  LoadingOutlined
} from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import type {
  ImportExecuteResult,
  ImportFailure,
  ImportFormat,
  ImportMode,
  ImportPreviewResult,
  ImportPreviewRow,
  ImportProgress,
  ImportStage
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
        background: 'var(--ant-color-bg-layout)',
        border: '1px solid var(--ant-color-border-secondary)',
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

function fileBaseName(p: string): string {
  const norm = p.replace(/\\/g, '/')
  return norm.split('/').pop() ?? p
}

export default function ImportPanel(): JSX.Element {
  const { message, modal } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const selectedIndex = useWorkspaceStore((s) => s.selectedIndex)
  const indexList = useWorkspaceStore((s) => s.indices)
  const runImport = useWorkspaceStore((s) => s.runImport)

  const [targetIndex, setTargetIndex] = useState<string>(selectedIndex ?? '')
  const [pickedFile, setPickedFile] = useState<{
    filePath: string
    detectedFormat: ImportFormat
  } | null>(null)
  /** The user-chosen (or "auto") format. `auto` means "infer from
   *  extension on the main side". */
  const [format, setFormat] = useState<ImportFormat>('auto')
  const [mode, setMode] = useState<ImportMode>('append')
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState<boolean>(false)
  const [result, setResult] = useState<ImportExecuteResult | null>(null)
  const [importing, setImporting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // V0.3.7 B-3: live progress for the current import job. Reset
  // on every new run so we don't briefly show numbers from a
  // previous job. The jobId on the latest event is matched against
  // the result we get back from `runImport` to drop stale events.
  const [progress, setProgress] = useState<ImportProgress | null>(null)

  // Subscribe to import progress events. The callback is stable
  // across renders (we store the latest progress in state and
  // close over `setProgress`); the unsubscribe handle is captured
  // for cleanup on unmount.
  useEffect(() => {
    const unsubscribe = window.esApi.importDocs.onProgress((p) => {
      setProgress(p)
    })
    return unsubscribe
  }, [])

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
    // V0.3.7 B-3: a new file means a new job — drop any leftover
    // progress from the previous one so the UI doesn't show
    // mid-run numbers for a job that hasn't started yet.
    setProgress(null)
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
    setPickedFile({
      filePath: res.data.filePath,
      detectedFormat: res.data.format
    })
    // Reset the format to "auto" on a new file so the extension-inferred
    // format from the picker is used by default.
    setFormat('auto')
    // Drop the previous preview — the new file may have a different shape.
    setPreview(null)
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
        format,
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

  /** The format that the execute step will actually use. Useful so the
   *  UI can show the resolved format to the user. */
  const resolvedFormat: ImportFormat = useMemo(() => {
    if (!pickedFile) return format
    if (format !== 'auto') return format
    return pickedFile.detectedFormat
  }, [format, pickedFile])

  const handleExecute = async (): Promise<void> => {
    if (!ready || !pickedFile || !activeConnectionId) return
    setErrorMsg(null)
    setResult(null)
    // Per plan §5.5.2, 覆盖 requires a second confirmation that
    // explicitly names the target index and states that the existing
    // documents will be deleted (not the index itself).
    if (mode === 'replace') {
      const ok = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: `覆盖导入到 "${targetIndex}" ？`,
          icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
          content: (
            <Space direction="vertical" size={4}>
              <Text>
                该操作会先清空索引 <Text code>{targetIndex}</Text> 下的所有现有文档，
                然后再写入文件内容。
              </Text>
              <Text type="danger">
                现有文档将被永久删除，但索引本身、Mapping 和 Settings 保持不变。
              </Text>
            </Space>
          ),
          okText: `清空并导入到 "${targetIndex}"`,
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        })
      })
      if (!ok) return
    }
    setImporting(true)
    // V0.3.7 B-3: wipe the progress before kicking off the job
    // so the UI doesn't show numbers from a previous import
    // until the first event for this run lands.
    setProgress(null)
    try {
      const res = await runImport({
        connectionId: activeConnectionId,
        index: targetIndex,
        filePath: pickedFile.filePath,
        format,
        mode
      })
      if (!res || !res.success || !res.data) {
        setErrorMsg(res?.error?.message ?? '导入失败')
        // Keep the latest `failed` event visible so the user can
        // see what stage we got to — the message comes from main.
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

  // V0.3.7 B-3: human-readable labels for each import stage.
  // Kept local to this component so the wording is owned by the
  // panel that paints it.
  const STAGE_LABEL: Record<ImportStage, string> = {
    reading: '读取文件中',
    parsing: '解析文件中',
    clearing: '清空索引中',
    writing: '写入文档中',
    completed: '已完成',
    failed: '失败'
  }

  // Only show the progress card while a job is running OR the
  // terminal event for the most recent job hasn't been consumed
  // by the result card yet. The terminal stages (`completed` /
  // `failed`) are shown briefly until the user moves on or the
  // result card replaces them.
  const showProgress =
    !!progress &&
    (importing ||
      progress.stage === 'completed' ||
      progress.stage === 'failed')
  const progressPercent = progress?.percent ?? 0
  const progressStatus: 'normal' | 'success' | 'exception' | 'active' =
    progress?.stage === 'completed'
      ? 'success'
      : progress?.stage === 'failed'
        ? 'exception'
        : progress && progress.percent !== null
          ? 'active'
          : 'normal'

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
            <Space wrap>
              <Button icon={<FileTextOutlined />} onClick={() => void handlePick()}>
                选择文件
              </Button>
              {pickedFile ? (
                <Space size={4} wrap>
                  <Text code>{fileBaseName(pickedFile.filePath)}</Text>
                  <Tag color="blue">{pickedFile.detectedFormat.toUpperCase()}</Tag>
                </Space>
              ) : (
                <Text type="secondary">未选择</Text>
              )}
            </Space>
          </Form.Item>

          <Form.Item label="导入格式" tooltip="自动识别按文件后缀 (.json / .ndjson / .csv) 推断；可手动切换。">
            <Select
              value={format}
              onChange={(v) => setFormat(v as ImportFormat)}
              style={{ width: 220 }}
              options={[
                { value: 'auto', label: '自动识别' },
                { value: 'json', label: 'JSON' },
                { value: 'ndjson', label: 'NDJSON' },
                { value: 'csv', label: 'CSV' }
              ]}
            />
            {pickedFile && format === 'auto' ? (
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                将按文件后缀自动解析为 {pickedFile.detectedFormat.toUpperCase()}
              </Text>
            ) : null}
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
                      (保留索引现有数据)
                    </Text>
                  </Space>
                </Radio>
                <Radio value="replace">
                  <Space size={4}>
                    <Text>覆盖</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      (先清空索引现有文档，再写入)
                    </Text>
                  </Space>
                </Radio>
              </Space>
            </Radio.Group>
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

      {/* V0.3.7 B-3: live progress card. Lives between the
          error/alert region and the final result card so the
          user sees the run progress and then the completed
          outcome in a single vertical flow. */}
      {showProgress && progress ? (
        <Card
          size="small"
          title={
            <Space>
              {progress.stage === 'completed' ? (
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
              ) : progress.stage === 'failed' ? (
                <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
              ) : (
                <LoadingOutlined />
              )}
              <Text>导入进度</Text>
              <Tag color="blue">{STAGE_LABEL[progress.stage]}</Tag>
            </Space>
          }
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Progress
              percent={progressPercent}
              status={progressStatus}
              showInfo
            />
            <Space size="large" wrap>
              {progress.total !== null ? (
                <Text>
                  总计{' '}
                  <Text strong>{progress.total.toLocaleString('en-US')}</Text>{' '}
                  条
                </Text>
              ) : null}
              {progress.processed !== null ? (
                <Text type="secondary">
                  已处理{' '}
                  <Text strong>
                    {progress.processed.toLocaleString('en-US')}
                  </Text>
                </Text>
              ) : null}
              <Text type="success">
                成功 <Text strong>{progress.success.toLocaleString('en-US')}</Text>
              </Text>
              <Text type={progress.failed > 0 ? 'danger' : 'secondary'}>
                失败 <Text strong>{progress.failed.toLocaleString('en-US')}</Text>
              </Text>
            </Space>
            {progress.message ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {progress.message}
              </Text>
            ) : null}
          </Space>
        </Card>
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
            <Space size="large" wrap>
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
              <Text type="secondary" style={{ fontSize: 12 }}>
                模式：<Text code>{mode === 'replace' ? '覆盖' : '追加'}</Text>
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
