/**
 * Export panel (phase 8).
 *
 * Tab content for the 导出 entry in `IndexDetailPanel`. Lets the user
 * pick an export format (JSON / NDJSON / CSV), a max row count, and a
 * destination on disk via the OS save dialog. The actual fetch +
 * serialize + file write happens in the main process so the renderer
 * never touches the filesystem.
 *
 * The MVP only supports `match_all` as the source query (see
 * `ai-dev-steps/08_EXPORT.md` — scroll / search_after is out of scope).
 */

import { useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Form,
  InputNumber,
  Radio,
  Space,
  Typography
} from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import { MAX_EXPORT_ROWS } from '@shared/ipc'
import type { ExportFormat } from '@shared/ipc'

const { Text, Paragraph } = Typography

const DEFAULT_MAX_ROWS = 1000

interface FormatHint {
  label: string
  description: string
}

const FORMAT_HINTS: Record<ExportFormat, FormatHint> = {
  json: {
    label: 'JSON',
    description:
      '导出为单个 JSON 数组，元素形如 `{ _id, _source }`。可被 phase 9 的 JSON 导入直接复用。'
  },
  ndjson: {
    label: 'NDJSON (Bulk)',
    description:
      '导出为换行分隔的 Bulk 兼容格式：每条文档先写 action 行（带 _index / _id），紧跟 _source 行。可直接喂给 ES `_bulk` API。'
  },
  csv: {
    label: 'CSV',
    description:
      '仅处理 _source 第一层字段，嵌套对象 / 数组会被 JSON 字符串化。带 UTF-8 BOM，Excel 中文不乱码。'
  }
}

export default function ExportPanel(): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const selectedIndex = useWorkspaceStore((s) => s.selectedIndex)

  const [format, setFormat] = useState<ExportFormat>('json')
  const [maxRows, setMaxRows] = useState<number>(DEFAULT_MAX_ROWS)
  const [exporting, setExporting] = useState<boolean>(false)
  const [lastResult, setLastResult] = useState<{
    outputPath: string
    rows: number
    bytes: number
  } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const ready = !!activeConnectionId && !!selectedIndex

  const handleExport = async (): Promise<void> => {
    if (!ready) return
    setErrorMsg(null)
    setLastResult(null)
    setExporting(true)
    try {
      const pickRes = await window.esApi.exportDocs.pickSavePath({
        index: selectedIndex as string,
        format
      })
      if (!pickRes.success || !pickRes.data) {
        setErrorMsg(pickRes.error?.message ?? '打开保存对话框失败')
        return
      }
      if (pickRes.data.outputPath === null) {
        // User cancelled — silent no-op.
        return
      }
      const execRes = await window.esApi.exportDocs.execute({
        connectionId: activeConnectionId as string,
        index: selectedIndex as string,
        format,
        outputPath: pickRes.data.outputPath,
        maxRows
      })
      if (!execRes.success || !execRes.data) {
        setErrorMsg(execRes.error?.message ?? '导出失败')
        return
      }
      const r = execRes.data
      setLastResult({
        outputPath: r.outputPath,
        rows: r.rows,
        bytes: r.bytes
      })
      const kb = (r.bytes / 1024).toFixed(1)
      message.success(`已导出 ${r.rows} 条到 ${r.outputPath} (${kb} KB)`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      {!ready ? (
        <Alert
          type="warning"
          showIcon
          message="请先选择连接和索引"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Card size="small" title="导出设置">
        <Form layout="vertical" disabled={!ready || exporting}>
          <Form.Item label="导出格式" required>
            <Radio.Group
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
            >
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {(Object.keys(FORMAT_HINTS) as ExportFormat[]).map((k) => (
                  <Radio key={k} value={k}>
                    <Space size={6} align="baseline">
                      <Text strong>{FORMAT_HINTS[k].label}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {FORMAT_HINTS[k].description}
                      </Text>
                    </Space>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            label={
              <Space size={4}>
                <Text>最大导出数量</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  (硬上限 {MAX_EXPORT_ROWS.toLocaleString('en-US')} 条，
                  超出自动截断)
                </Text>
              </Space>
            }
            required
          >
            <InputNumber
              value={maxRows}
              min={1}
              max={MAX_EXPORT_ROWS}
              step={100}
              onChange={(v) => {
                if (typeof v === 'number') setMaxRows(v)
              }}
              style={{ width: 200 }}
              addonAfter="条"
            />
          </Form.Item>

          <Form.Item label="查询范围">
            <Paragraph
              type="secondary"
              style={{ fontSize: 12, marginBottom: 0 }}
            >
              当前 MVP：固定使用 <Text code>match_all</Text> 拉取该索引全部文档，
              按 <Text code>_doc</Text> 顺序截取前 N 条。不支持自定义 DSL 或 Scroll。
            </Paragraph>
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => void handleExport()}
              loading={exporting}
              disabled={!ready}
            >
              选择保存路径并导出
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {errorMsg ? (
        <Alert
          type="error"
          showIcon
          message="导出失败"
          description={errorMsg}
          style={{ marginTop: 16 }}
        />
      ) : null}

      {lastResult ? (
        <Alert
          type="success"
          showIcon
          message={`已导出 ${lastResult.rows.toLocaleString('en-US')} 条`}
          description={
            <Space direction="vertical" size={2}>
              <Text>
                文件路径：<Text code>{lastResult.outputPath}</Text>
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                大小：{(lastResult.bytes / 1024).toFixed(1)} KB
              </Text>
            </Space>
          }
          style={{ marginTop: 16 }}
        />
      ) : null}
    </div>
  )
}