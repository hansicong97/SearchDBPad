/**
 * DSL query panel (V0.3.6 B-2).
 *
 * Tab content for the 查询 entry in `IndexDetailPanel`. The editor
 * area is organised as a list of tabs, each carrying its own
 * (title, target index, DSL body, results, loading, error). This
 * makes it possible to draft several queries in parallel and
 * switch between them without losing context.
 *
 *   - the tab bar lives above the editor; each tab shows a
 *     title (double-click to rename) and a close button
 *   - a 「+ 新建查询」 button at the end of the bar creates
 *     a fresh tab and switches to it
 *   - the active tab's body is a Monaco JSON editor for the
 *     `_search` body, with format / run / 收藏 buttons below
 *   - the result area (took / total / hits / raw response)
 *     is also scoped to the active tab
 *
 * The list of tabs is reset whenever the user switches
 * connections or indices — the store wipes the list in those
 * flows, so this component just creates a default tab the first
 * time it renders for a freshly selected index.
 *
 * Importing `./monacoEnv` here ensures Monaco's worker wiring and the
 * local loader config run before the editor mounts.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Alert,
  Button,
  Empty,
  Input,
  Popover,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CheckCircleOutlined,
  CloseOutlined,
  CodeOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  StarOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import JsonView from './JsonView'
import DslFavoriteModal from './DslFavoriteModal'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { DocumentHit, DslFavorite } from '@shared/ipc'
import type { DslTab } from '../stores/workspace.store'

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
        background: 'var(--ant-color-bg-layout)',
        border: '1px solid var(--ant-color-border-secondary)',
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

/** Inline rename popover. The user clicks the pencil icon next to a
 *  tab title; this opens a popover with an Input. Submit on
 *  Enter / blur; cancel on Escape. */
function RenamePopover({
  initial,
  onSubmit,
  onCancel
}: {
  initial: string
  onSubmit: (name: string) => boolean
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  // Keep the input in sync if the underlying tab title changes
  // (e.g. another panel renamed it).
  useEffect(() => {
    setValue(initial)
  }, [initial])
  const submit = (): void => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== initial) {
      const ok = onSubmit(trimmed)
      if (!ok) return
    }
    onCancel()
  }
  return (
    <Space.Compact style={{ width: 220 }}>
      <Input
        autoFocus
        size="small"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPressEnter={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        // Blur acts as confirm — the most common popover pattern.
        onBlur={submit}
      />
    </Space.Compact>
  )
}

export default function DslQueryPanel(): JSX.Element {
  const { message } = AntdApp.useApp()
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const selectedIndex = useWorkspaceStore((s) => s.selectedIndex)
  const dslTabs = useWorkspaceStore((s) => s.dslTabs)
  const activeDslTabId = useWorkspaceStore((s) => s.activeDslTabId)
  const addDslTab = useWorkspaceStore((s) => s.addDslTab)
  const closeDslTab = useWorkspaceStore((s) => s.closeDslTab)
  const selectDslTab = useWorkspaceStore((s) => s.selectDslTab)
  const renameDslTab = useWorkspaceStore((s) => s.renameDslTab)
  const updateDslTabContent = useWorkspaceStore((s) => s.updateDslTabContent)
  const setDslTabIndex = useWorkspaceStore((s) => s.setDslTabIndex)
  const runDslTabQuery = useWorkspaceStore((s) => s.runDslTabQuery)

  // V0.3.5 B-4: favorites modal visibility.
  const [favoriteOpen, setFavoriteOpen] = useState(false)
  // `parseError` is scoped to the editor content of the *current*
  // edit — the Monaco editor handles syntax highlighting, but we
  // also surface a parse error as a tag on the run button so the
  // user knows why it's disabled.
  const [parseError, setParseError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState<boolean>(false)

  // Auto-create a default tab the first time the panel mounts for
  // a selected index. The store resets the list on connection /
  // index change, so this effect runs again after every navigation
  // and gives the user a starting point.
  useEffect(() => {
    if (selectedIndex && dslTabs.length === 0) {
      addDslTab()
    }
    // We intentionally only react to selectedIndex; the other
    // dependencies are read inside `addDslTab` and we don't want
    // to re-trigger on every list mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex])

  const activeTab = useMemo<DslTab | null>(() => {
    if (!activeDslTabId) return null
    return dslTabs.find((t) => t.id === activeDslTabId) ?? null
  }, [dslTabs, activeDslTabId])

  /** True only when the editor content is syntactically valid JSON. */
  const isValidJson = useMemo<boolean>(() => {
    if (!activeTab) return false
    try {
      JSON.parse(activeTab.dsl)
      return true
    } catch {
      return false
    }
  }, [activeTab])

  const handleAddTab = (): void => {
    if (!selectedIndex) {
      message.warning('请先选择索引后再新建查询')
      return
    }
    addDslTab()
  }

  const handleCloseTab = (id: string): void => {
    closeDslTab(id)
  }

  const handleSelectTab = (id: string): void => {
    selectDslTab(id)
  }

  const handleRenameTab = (id: string, name: string): boolean => {
    const ok = renameDslTab(id, name)
    if (!ok) {
      message.error('名称不能为空')
    }
    return ok
  }

  const handleFormat = (): void => {
    if (!activeTab) return
    try {
      const parsed = JSON.parse(activeTab.dsl) as unknown
      updateDslTabContent(activeTab.id, JSON.stringify(parsed, null, 2))
      setParseError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setParseError(msg)
      message.error(`JSON 不合法：${msg}`)
    }
  }

  const handleRun = async (): Promise<void> => {
    if (!activeTab) return
    try {
      JSON.parse(activeTab.dsl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setParseError(msg)
      message.error(`JSON 不合法：${msg}`)
      return
    }
    setParseError(null)
    await runDslTabQuery(activeTab.id)
  }

  const handlePickFavorite = (favorite: DslFavorite): void => {
    if (!activeTab) return
    updateDslTabContent(activeTab.id, favorite.dsl)
    setParseError(null)
    message.success(`已加载收藏 "${favorite.name}"`)
  }

  const hits = activeTab?.results?.hits ?? []

  const tabItems = dslTabs.map((tab) => ({
    key: tab.id,
    label: (
      <span
        // Suppress the global double-click-to-rename hint that some
        // shells display on double-click selection. The actual
        // rename UI is the pencil icon, so this is enough.
        onDoubleClick={(e) => e.stopPropagation()}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Tooltip title={tab.title} placement="topLeft">
          <Text
            strong={tab.id === activeDslTabId}
            style={{
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.title}
          </Text>
        </Tooltip>
        {tab.id === activeDslTabId ? (
          <Popover
            trigger="click"
            placement="bottom"
            destroyTooltipOnHide
            content={
              <RenamePopover
                initial={tab.title}
                onSubmit={(name) => handleRenameTab(tab.id, name)}
                onCancel={() => {
                  /* close on next click — antd's Popover handles it */
                }}
              />
            }
          >
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              style={{ width: 20, height: 20, padding: 0 }}
              onClick={(e) => e.stopPropagation()}
            />
          </Popover>
        ) : null}
        {dslTabs.length > 1 ? (
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            style={{ width: 20, height: 20, padding: 0 }}
            onClick={(e) => {
              e.stopPropagation()
              handleCloseTab(tab.id)
            }}
          />
        ) : null}
      </span>
    ),
    children: null
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid var(--ant-color-border-secondary)'
        }}
      >
        <Tabs
          activeKey={activeDslTabId ?? undefined}
          onChange={handleSelectTab}
          items={tabItems}
          size="small"
          tabBarStyle={{ marginBottom: 0, flex: 1, minWidth: 0 }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Tooltip title="新建查询">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={handleAddTab}
            style={{ marginRight: 8 }}
          />
        </Tooltip>
      </div>

      {!activeTab ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            selectedIndex
              ? '正在准备查询区…'
              : '请先在索引列表中选择一个索引'
          }
        />
      ) : (
        <>
          <div>
            <Space style={{ marginBottom: 8 }} size="small" wrap>
              <Tooltip title="此查询将发往该索引">
                <Input
                  size="small"
                  value={activeTab.indexName}
                  onChange={(e) => setDslTabIndex(activeTab.id, e.target.value)}
                  placeholder="目标索引"
                  style={{ width: 220 }}
                  prefix={<Text type="secondary" style={{ fontSize: 12 }}>idx</Text>}
                />
              </Tooltip>
              <Button
                icon={<CheckCircleOutlined />}
                onClick={handleFormat}
                size="small"
                disabled={!activeTab.dsl.trim()}
              >
                格式化
              </Button>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => void handleRun()}
                disabled={!isValidJson || !activeTab.indexName.trim() || activeTab.loading}
                loading={activeTab.loading}
                size="small"
              >
                执行查询
              </Button>
              <Button
                icon={<StarOutlined />}
                onClick={() => setFavoriteOpen(true)}
                size="small"
              >
                收藏
              </Button>
              <Tag color={isValidJson ? 'success' : 'error'} style={{ margin: 0 }}>
                {isValidJson ? 'JSON 合法' : 'JSON 不合法'}
              </Tag>
            </Space>

            <div
              style={{
                border: '1px solid var(--ant-color-border)',
                borderRadius: 4,
                overflow: 'hidden',
                background: '#1e1e1e'
              }}
            >
              <Editor
                height="220px"
                defaultLanguage="json"
                value={activeTab.dsl}
                theme="vs-dark"
                onChange={(v) =>
                  updateDslTabContent(activeTab.id, v ?? '')
                }
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
            {activeTab.error ? (
              <Alert
                type="error"
                showIcon
                message="查询失败"
                description={activeTab.error}
              />
            ) : activeTab.loading && !activeTab.results ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : !activeTab.results ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="执行一次查询以查看结果"
              />
            ) : (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space size="middle" wrap>
                  <Tag icon={<ThunderboltOutlined />} color="blue">
                    took {activeTab.results.took} ms
                  </Tag>
                  <Tag color="geekblue">
                    total {activeTab.results.totalRelation === 'gte' ? '≥ ' : ''}
                    {activeTab.results.total.toLocaleString('en-US')}
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
                    columns={
                      [
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
                            v === null || v === undefined ? (
                              <Text type="secondary">-</Text>
                            ) : (
                              v.toFixed(3)
                            )
                        },
                        {
                          title: '_source',
                          dataIndex: '_source',
                          key: '_source',
                          render: (_v: unknown, record: DocumentHit) => (
                            <HitRow value={record._source} />
                          )
                        }
                      ] as ColumnsType<DocumentHit>
                    }
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
                    <JsonView data={activeTab.results.raw} maxHeight={320} />
                  </div>
                ) : null}
              </Space>
            )}
          </div>

          <DslFavoriteModal
            open={favoriteOpen}
            currentDsl={activeTab.dsl}
            currentIndexName={activeTab.indexName}
            onClose={() => setFavoriteOpen(false)}
            onSelect={handlePickFavorite}
          />
        </>
      )}
    </div>
  )
}
