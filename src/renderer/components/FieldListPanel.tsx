/**
 * Mapping field list panel (V0.3.5 B-1).
 *
 * Tab content for the "字段" entry in `IndexDetailPanel`. Reads the
 * raw mapping JSON from the store, walks `properties` to produce
 * a flat field list, and renders it with a client-side search
 * filter.
 *
 * The mapping payload is fetched by `fetchMapping` (V0.3.3 A-3
 * shares it with the append-fields modal), so this panel adds no
 * new IPC traffic — switching to the tab is free.
 *
 * The search is a simple substring match against the dot-separated
 * path. We deliberately do NOT search by type: the path is the
 * primary mental model for "which field did I just write to" and
 * the type column is short enough to scan visually.
 */

import { useMemo, useState } from 'react'
import {
  Empty,
  Input,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { SearchOutlined } from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/workspace.store'
import {
  extractMappingFields,
  filterMappingFields,
  type MappingField
} from '../utils/mappingFields'

const { Text } = Typography

function typeColor(type: string): string {
  switch (type) {
    case 'text':
    case 'keyword':
      return 'blue'
    case 'long':
    case 'integer':
    case 'short':
    case 'byte':
    case 'double':
    case 'float':
    case 'half_float':
    case 'scaled_float':
    case 'date':
    case 'boolean':
    case 'ip':
    case 'geo_point':
      return 'green'
    case 'object':
    case 'nested':
      return 'purple'
    default:
      return 'default'
  }
}

export default function FieldListPanel(): JSX.Element {
  const mapping = useWorkspaceStore((s) => s.mapping)
  const loading = useWorkspaceStore((s) => s.mappingLoading)
  const error = useWorkspaceStore((s) => s.mappingError)

  const [keyword, setKeyword] = useState('')

  const fields = useMemo(() => extractMappingFields(mapping), [mapping])
  const filtered = useMemo(
    () => filterMappingFields(fields, keyword),
    [fields, keyword]
  )

  const columns: ColumnsType<MappingField> = [
    {
      title: '字段路径',
      dataIndex: 'path',
      key: 'path',
      ellipsis: true,
      render: (v: string, record) => (
        <Tooltip title={v} placement="topLeft">
          <Text strong style={{ wordBreak: 'break-all' }}>
            {v}
          </Text>
          {record.isMultiField ? (
            <Tag color="gold" style={{ marginLeft: 8 }}>
              multi-field
            </Tag>
          ) : null}
        </Tooltip>
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 140,
      render: (v: string) => <Tag color={typeColor(v)}>{v}</Tag>
    }
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: 12
      }}
    >
      <Space size="middle" wrap>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="按字段路径搜索（支持子串匹配）"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 320 }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {keyword
            ? `匹配 ${filtered.length} / ${fields.length}`
            : `共 ${fields.length} 个字段`}
        </Text>
      </Space>

      {error ? (
        <Text type="danger">无法加载字段列表：{error}</Text>
      ) : loading && !mapping ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : fields.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="该索引没有 mapping 字段（可能尚未定义 mapping）"
        />
      ) : (
        <Table<MappingField>
          rowKey="path"
          columns={columns}
          dataSource={filtered}
          size="middle"
          pagination={{
            defaultPageSize: 20,
            pageSizeOptions: [10, 20, 50, 100],
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`
          }}
          scroll={{ x: 'max-content' }}
        />
      )}
    </div>
  )
}
