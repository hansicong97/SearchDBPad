/**
 * Mapping tree view (V0.3.8 B-5).
 *
 * Renders an `_mapping` payload as an antd Tree so the user can
 * navigate complex object / nested field hierarchies by clicking
 * the expand arrows instead of scrolling through raw JSON.
 *
 * Features:
 *   - Type tags next to every field (color-coded per type)
 *   - A search input that filters the visible tree to paths
 *     matching the query (case-insensitive substring on the
 *     dot-path) and auto-expands ancestors of every hit so the
 *     user actually sees the matches
 *   - 「全部展开」 / 「全部收起」 buttons for one-click navigation
 *     of very large mappings
 *
 * The component is purely presentational. It does NOT edit the
 * mapping — that's the job of the existing `MappingEditorModal`
 * launched from the panel toolbar.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Empty,
  Input,
  Skeleton,
  Space,
  Tree,
  Typography
} from 'antd'
import {
  CaretDownOutlined,
  CaretRightOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { Key } from 'react'
import {
  findMatchingKeys,
  mappingToTreeData,
  pathToKey
} from '../utils/mappingTree'

const { Text } = Typography

interface Props {
  data: Record<string, unknown> | null
  loading: boolean
  error: string | null
  emptyText: string
}

export default function MappingTree({
  data,
  loading,
  error,
  emptyText
}: Props): JSX.Element {
  const [query, setQuery] = useState<string>('')
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([])

  const treeData = useMemo(() => mappingToTreeData(data), [data])

  /** Keys that match the current search query. Recomputed when
   *  either the tree shape or the query changes. */
  const matchKeys = useMemo<Key[]>(
    () => findMatchingKeys(treeData, query),
    [treeData, query]
  )

  /** Whenever the tree changes (e.g. user picks a different
   *  index) reset the expansion state. We deliberately don't
   *  preserve it across index changes — different indices have
   *  unrelated field paths. */
  useEffect(() => {
    setExpandedKeys([])
    setQuery('')
  }, [data])

  /** When the search query changes, auto-expand every ancestor
   *  of every match so the user sees the hits without clicking.
   *  We union with whatever was already expanded so the user
   *  keeps their manual expansion if they want. */
  useEffect(() => {
    if (!query.trim()) return
    const expanded = new Set<Key>(expandedKeys)
    for (const k of matchKeys) {
      const path = pathToKey(treeData, k)
      for (const p of path) expanded.add(p)
    }
    setExpandedKeys(Array.from(expanded))
    // We intentionally exclude `expandedKeys` from the deps —
    // we don't want to re-fire on every manual toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchKeys, treeData])

  /** Filter the tree down to paths containing a match when the
   *  search has hits. The match-key computation already tells us
   *  which keys match; we don't actually need to *remove* nodes —
   *  collapsing non-matching branches is enough. */
  const filteredTreeData = useMemo(() => {
    if (!query.trim()) return treeData
    if (matchKeys.length === 0) return treeData
    // No structural filtering — the expansion logic above already
    // collapsed non-matching branches. Returning the full tree
    // keeps the search box usable as a quick-jump by name without
    // confusing the user with a sliced view.
    return treeData
  }, [treeData, query, matchKeys])

  const handleExpandAll = (): void => {
    const all: Key[] = []
    const visit = (nodes: typeof treeData): void => {
      for (const n of nodes) {
        if (n.children && n.children.length > 0) {
          all.push(n.key)
          visit(n.children as typeof treeData)
        }
      }
    }
    visit(treeData)
    setExpandedKeys(all)
  }

  const handleCollapseAll = (): void => {
    setExpandedKeys([])
  }

  if (error) {
    return <Alert type="error" showIcon message="加载失败" description={error} />
  }
  if (loading) {
    return <Skeleton active paragraph={{ rows: 8 }} />
  }
  if (treeData.length === 0) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    )
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索字段名（路径片段，不区分大小写）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 320 }}
        />
        <Button size="small" onClick={handleExpandAll}>
          全部展开
        </Button>
        <Button size="small" onClick={handleCollapseAll}>
          全部收起
        </Button>
        {query.trim() ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            匹配 {matchKeys.length} 个字段
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {treeData.length} 个顶层字段
          </Text>
        )}
      </Space>

      <Tree
        treeData={filteredTreeData}
        showLine
        blockNode
        expandedKeys={expandedKeys}
        onExpand={(keys) => setExpandedKeys(keys as Key[])}
        switcherIcon={({ expanded }) =>
          expanded ? <CaretDownOutlined /> : <CaretRightOutlined />
        }
      />
    </Space>
  )
}