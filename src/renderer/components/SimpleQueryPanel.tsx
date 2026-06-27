/**
 * Simple query panel (phase 6).
 *
 * Tab content for the 简单查询 entry in `IndexDetailPanel`. Wraps the
 * `(field, operator, value) → DSL` builder in a small form, sends the
 * result to the same `document:search` IPC the document / DSL tabs use,
 * and renders hits in a results table that mirrors phase 5 styling.
 *
 * State split:
 *   - form values (field / operator / value) live in this component's
 *     local useState — they're not stored across tab switches.
 *   - the search result + loading / error live in `useWorkspaceStore`
 *     so the WorkspacePage can surface the error as a toast.
 */

import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  PlayCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import {
  buildSimpleDsl,
  SIMPLE_OPERATORS,
  type SimpleOperator
} from '../utils/buildSimpleDsl'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { DocumentHit } from '@shared/ipc'

const { Text } = Typography

const DEFAULT_OPERATOR: SimpleOperator = 'match'
const DEFAULT_FIELD = ''
const DEFAULT_VALUE = ''
const RESULT_SIZE = 20

function HitSourceCell({
  value
}: {
  value: Record<string, unknown> | null
}): JSX.Element {
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

export default function SimpleQueryPanel(): JSX.Element {
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const selectedIndex = useWorkspaceStore((s) => s.selectedIndex)
  const simpleResults = useWorkspaceStore((s) => s.simpleResults)
  const simpleLoading = useWorkspaceStore((s) => s.simpleLoading)
  const simpleError = useWorkspaceStore((s) => s.simpleError)
  const runSimpleQuery = useWorkspaceStore((s) => s.runSimpleQuery)

  const [field, setField] = useState(DEFAULT_FIELD)
  const [operator, setOperator] = useState<SimpleOperator>(DEFAULT_OPERATOR)
  const [value, setValue] = useState(DEFAULT_VALUE)
  const [formError, setFormError] = useState<string | null>(null)

  const operatorMeta = useMemo(
    () => SIMPLE_OPERATORS.find((o) => o.value === operator),
    [operator]
  )
  const valueRequired = operatorMeta?.requiresValue ?? true

  const handleReset = (): void => {
    setField(DEFAULT_FIELD)
    setOperator(DEFAULT_OPERATOR)
    setValue(DEFAULT_VALUE)
    setFormError(null)
  }

  const handleRun = async (): Promise<void> => {
    if (!activeConnectionId || !selectedIndex) return
    // V0.3.9 E-6: when the field name is empty, skip the form
    // builder entirely and run a match_all query so the user can
    // browse every document in the index without first picking a
    // field. We still keep pagination reasonable (RESULT_SIZE)
    // so the response stays scannable.
    let body: Record<string, unknown>
    if (!field.trim()) {
      body = { query: { match_all: {} }, size: RESULT_SIZE }
    } else {
      const built = buildSimpleDsl(field, operator, value)
      if (!built) {
        setFormError('请输入字段名')
        return
      }
      body = built
    }
    if (valueRequired && value.trim() === '') {
      setFormError(`操作符「${operatorMeta?.label ?? operator}」需要查询值`)
      return
    }
    setFormError(null)
    // Errors surface inline (Alert) AND as a toast from
    // WorkspacePage's simpleError effect — no second toast here.
    await runSimpleQuery(activeConnectionId, selectedIndex, body)
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
      render: (_v: unknown, record: DocumentHit) => (
        <HitSourceCell value={record._source} />
      )
    }
  ]

  const hits = simpleResults?.hits ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <Form layout="inline" onFinish={() => void handleRun()}>
        <Form.Item label="字段">
          <Input
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder="username（留空查询全部）"
            style={{ width: 200 }}
            allowClear
          />
        </Form.Item>
        <Form.Item label="操作符">
          <Select<SimpleOperator>
            value={operator}
            onChange={setOperator}
            style={{ width: 130 }}
            options={SIMPLE_OPERATORS.map((o) => ({
              value: o.value,
              label: o.label
            }))}
          />
        </Form.Item>
        <Form.Item label="值">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={valueRequired ? '查询值' : '该操作符不要求值'}
            style={{ width: 220 }}
            disabled={!valueRequired}
            allowClear
          />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => void handleRun()}
              loading={simpleLoading}
            >
              查询
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleReset}
              disabled={simpleLoading}
            >
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>

      {formError ? (
        <Alert type="warning" showIcon message={formError} />
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {simpleError ? (
          <Alert type="error" showIcon message="查询失败" description={simpleError} />
        ) : simpleLoading && !simpleResults ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : !simpleResults ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="填写字段、操作符和值后点击查询（字段留空会查询全部）"
          />
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space size="middle">
              <Tag icon={<ThunderboltOutlined />} color="blue">
                took {simpleResults.took} ms
              </Tag>
              <Tag color="geekblue">
                total {simpleResults.totalRelation === 'gte' ? '≥ ' : ''}
                {simpleResults.total.toLocaleString('en-US')}
              </Tag>
              <Tag>
                本次最多展示 {RESULT_SIZE} 条 · 实际 {hits.length} 条
              </Tag>
            </Space>
            {hits.length === 0 ? (
              <Empty description="没有命中任何文档" />
            ) : (
              <Table<DocumentHit>
                rowKey="_id"
                columns={columns}
                dataSource={hits}
                size="small"
                pagination={false}
              />
            )}
          </Space>
        )}
      </div>
    </div>
  )
}