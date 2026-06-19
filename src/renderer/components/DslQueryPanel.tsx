/**
 * DSL query panel (phase 5).
 *
 * Tab content for the 查询 entry in `IndexDetailPanel`. Provides a JSON
 * editor (Monaco) for the caller to write an arbitrary Elasticsearch
 * `_search` body, plus:
 *
 *   - format / pretty-print button
 *   - run button (disabled when JSON is invalid)
 *   - inline JSON validation error
 *   - result summary (took, total)
 *   - result hits table
 *   - optional raw-response viewer (uses the existing JsonView)
 *
 * Importing `./monacoEnv` here ensures Monaco's worker wiring and the
 * local loader config run before the editor mounts.
 */

import { useMemo, useState } from 'react'
import {
  App as AntdApp,
  Alert,
  Button,
  Empty,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CheckCircleOutlined,
  CodeOutlined,
  PlayCircleOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import JsonView from './JsonView'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { DocumentHit } from '@shared/ipc'

// Side-effect import — wires Monaco workers + loader config before the
// editor is rendered.
import './monacoEnv'

const { Text } = Typography

const DEFAULT_DSL = '{\n  "query": {\n    "match_all": {}\n  },\n  "size": 20\n}'

function HitRow({ value }: { value: Record<string, unknown> | null }): JSX.Element {
  if (value === null) {
    return <Text type="secondary">(无 _source)</Text>
  }
  const pretty = (() => {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  })()
  return (
    <pre
      style={{
        background: '#fafafa',
        border: '1px solid #f0f0f0',
        borderRadius: 4,
        padding: 8,
        margin: 0,
        maxHeight: 200,
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

export default function DslQueryPanel(): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const selectedIndex = useWorkspaceStore((s) => s.selectedIndex)
  const dslResults = useWorkspaceStore((s) => s.dslResults)
  const dslLoading = useWorkspaceStore((s) => s.dslLoading)
  const dslError = useWorkspaceStore((s) => s.dslError)
  const runDslQuery = useWorkspaceStore((s) => s.runDslQuery)

  const [content, setContent] = useState<string>(DEFAULT_DSL)
  const [parseError, setParseError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState<boolean>(false)

  /** True only when the editor content is syntactically valid JSON. */
  const isValidJson = useMemo<boolean>(() => {
    try {
      JSON.parse(content)
      return true
    } catch {
      return false
    }
  }, [content])

  const handleFormat = (): void => {
    try {
      const parsed = JSON.parse(content) as unknown
      setContent(JSON.stringify(parsed, null, 2))
      setParseError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setParseError(msg)
      message.error(`JSON 不合法：${msg}`)
    }
  }

  const handleRun = async (): Promise<void> => {
    if (!activeConnectionId || !selectedIndex) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(content) as Record<string, unknown>
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setParseError(msg)
      message.error(`JSON 不合法：${msg}`)
      return
    }
    setParseError(null)
    // Errors are surfaced inline (Alert) AND as a toast from
    // WorkspacePage's dslError effect — no need for a second toast here.
    await runDslQuery(activeConnectionId, selectedIndex, parsed)
  }

  const columns: ColumnsType<DocumentHit> = [
    {
      title: '_id',
      dataIndex: '_id',
      key: '_id',
      width: 220,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft">
          <Text strong style={{ wordBreak: 'break-all' }}>
            {v}
          </Text>
        </Tooltip>
      )
    },
    {
      title: '_score',
      dataIndex: '_score',
      key: '_score',
      width: 90,
      align: 'right',
      render: (v: number | null) =>
        v === null || v === undefined ? <Text type="secondary">-</Text> : v.toFixed(3)
    },
    {
      title: '_source',
      dataIndex: '_source',
      key: '_source',
      render: (_v: unknown, record: DocumentHit) => <HitRow value={record._source} />
    }
  ]

  const hits = dslResults?.hits ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div>
        <Space style={{ marginBottom: 8 }} size="small">
          <Button
            icon={<CheckCircleOutlined />}
            onClick={handleFormat}
            size="small"
          >
            格式化
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={() => void handleRun()}
            disabled={!isValidJson || dslLoading}
            loading={dslLoading}
            size="small"
          >
            执行查询
          </Button>
          <Tag color={isValidJson ? 'success' : 'error'} style={{ margin: 0 }}>
            {isValidJson ? 'JSON 合法' : 'JSON 不合法'}
          </Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            · 编辑器内容会原样发送到 POST /{selectedIndex ?? '<index>'}/_search
          </Text>
        </Space>

        <div
          style={{
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            overflow: 'hidden',
            background: '#1e1e1e'
          }}
        >
          <Editor
            height="220px"
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

        {parseError ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 8 }}
            message="JSON 解析失败"
            description={parseError}
          />
        ) : null}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {dslError ? (
          <Alert
            type="error"
            showIcon
            message="查询失败"
            description={dslError}
          />
        ) : dslLoading && !dslResults ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : !dslResults ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="执行一次查询以查看结果"
          />
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space size="middle">
              <Tag icon={<ThunderboltOutlined />} color="blue">
                took {dslResults.took} ms
              </Tag>
              <Tag color="geekblue">
                total {dslResults.totalRelation === 'gte' ? '≥ ' : ''}
                {dslResults.total.toLocaleString('en-US')}
              </Tag>
              <Tag>{hits.length} hits</Tag>
              <Button
                size="small"
                type="link"
                icon={<CodeOutlined />}
                onClick={() => setShowRaw((v) => !v)}
              >
                {showRaw ? '隐藏原始响应' : '查看原始响应'}
              </Button>
            </Space>

            {hits.length === 0 ? (
              <Empty description="没有命中任何文档" />
            ) : (
              <Table<DocumentHit>
                rowKey="_id"
                columns={columns}
                dataSource={hits}
                size="small"
                pagination={{
                  defaultPageSize: 20,
                  pageSizeOptions: [10, 20, 50, 100],
                  showSizeChanger: true,
                  showTotal: (t) => `共 ${t} 条`
                }}
              />
            )}

            {showRaw ? (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  原始响应
                </Text>
                <JsonView data={dslResults.raw} maxHeight={320} />
              </div>
            ) : null}
          </Space>
        )}
      </div>
    </div>
  )
}