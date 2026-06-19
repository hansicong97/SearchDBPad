/**
 * Reusable formatted JSON viewer.
 *
 * Phase 4 scope: render the raw payload returned by `index:mapping` and
 * `index:settings` with a "copy" button. The viewer is intentionally
 * dependency-free: it formats with `JSON.stringify(..., null, 2)` and
 * writes to the clipboard via the standard browser API.
 *
 * Later phases (import / export, DSL query) can reuse this component
 * without modification.
 */

import { useMemo, useState } from 'react'
import { App as AntdApp, Button, Empty, Skeleton, Space, Typography } from 'antd'
import { CopyOutlined } from '@ant-design/icons'

const { Text } = Typography

interface Props {
  data: unknown
  loading?: boolean
  error?: string | null
  emptyText?: string
  /** Max height of the scroll area. Defaults to a generous 480px. */
  maxHeight?: number
}

export default function JsonView({
  data,
  loading,
  error,
  emptyText,
  maxHeight = 480
}: Props): JSX.Element {
  const { message } = AntdApp.useApp()
  const [copied, setCopied] = useState(false)

  const formatted = useMemo<string | null>(() => {
    if (data === undefined || data === null) return null
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return null
    }
  }, [data])

  if (loading) {
    return <Skeleton active paragraph={{ rows: 6 }} />
  }

  if (error) {
    return (
      <Text type="danger">加载失败：{error}</Text>
    )
  }

  if (formatted === null || formatted === '') {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={emptyText ?? '暂无数据'}
      />
    )
  }

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(formatted)
      setCopied(true)
      message.success('已复制到剪贴板')
      window.setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      message.error(
        `复制失败: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 8 }} size="small">
        <Button
          icon={<CopyOutlined />}
          onClick={() => void handleCopy()}
          size="small"
        >
          {copied ? '已复制' : '复制 JSON'}
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatByteSize(formatted)} · {countLines(formatted)} 行
        </Text>
      </Space>
      <pre
        style={{
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 4,
          padding: 12,
          margin: 0,
          maxHeight,
          overflow: 'auto',
          fontSize: 12,
          lineHeight: 1.5,
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          whiteSpace: 'pre'
        }}
      >
        {formatted}
      </pre>
    </div>
  )
}

function formatByteSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  // Fast count without splitting the whole string.
  let n = 1
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) n += 1
  }
  return n
}
