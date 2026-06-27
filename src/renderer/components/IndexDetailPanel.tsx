/**
 * Index detail panel (phase 4 + 5 + 6 + 7 + 8 + 9 + layout fix in 13 +
 *  V0.3.2 A-2 + V0.3.3 A-3 + V0.3.4 A-4 + V0.3.5 B-1).
 *
 * Shown in the workspace when an index is selected. Nine tabs:
 *   - 文档      (phase 5) — paginated document table, default match_all
 *   - 简单查询  (phase 6) — single-clause form query
 *   - 查询      (phase 5) — Monaco JSON editor for arbitrary DSL queries
 *   - 字段      (V0.3.5 B-1) — flat list of mapping fields with search
 *   - Mapping   (phase 4) — antd-tree view of mapping fields with
 *                          search + auto-expand (V0.3.8 B-5); the
 *                          append modal still uses the raw JSON
 *                          via `JsonView` when opened
 *                          (+ V0.3.3 append modal)
 *   - Settings  (phase 4) — GET /{index}/_settings (+ V0.3.2 edit modal)
 *   - Alias     (V0.3.4 A-4) — list / add / delete aliases for this index
 *   - 导出      (phase 8) — JSON / NDJSON / CSV export
 *   - 导入      (phase 9) — JSON / NDJSON / CSV import via Bulk API
 *
 * Phase 7 (document CRUD) lives inside the 文档 tab as row actions and
 * the 编辑 modal — no separate tab.
 *
 * Phase 13 (layout fix): the card body is a flex column with the tabs
 * header at fixed height and the active tab body owning its own scroll
 * container, so the panel scrolls independently from the rest of the
 * page.
 *
 * V0.3.2 A-2: Settings tab now exposes an 「编辑」 button that opens
 * SettingsEditorModal.
 *
 * V0.3.3 A-3: Mapping tab now exposes an 「追加字段」 button that
 * opens MappingEditorModal. Both tabs still render the read-only
 * JSON view from `JsonView` so the user can keep an eye on the
 * current value while editing.
 *
 * V0.3.4 A-4: Alias tab is per-index — the list is filtered down to
 * aliases that point at the currently selected index, and the add
 * flow always targets that index.
 *
 * V0.3.5 B-1: 字段 tab is a flat searchable view of the mapping's
 * fields. It shares the cached `mapping` payload with the Mapping
 * tab (no extra IPC traffic).
 */

import { useState } from 'react'
import { Button, Card, Space, Tabs, Tooltip, Typography } from 'antd'
import {
  ArrowLeftOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import AliasPanel from './AliasPanel'
import DocumentPanel from './DocumentPanel'
import DslQueryPanel from './DslQueryPanel'
import ExportPanel from './ExportPanel'
import FieldListPanel from './FieldListPanel'
import ImportPanel from './ImportPanel'
import JsonView from './JsonView'
import MappingEditorModal from './MappingEditorModal'
import MappingTree from './MappingTree'
import SettingsEditorModal from './SettingsEditorModal'
import ShardPanel from './ShardPanel'
import SimpleQueryPanel from './SimpleQueryPanel'
import { useWorkspaceStore } from '../stores/workspace.store'

const { Text, Title } = Typography

interface Props {
  indexName: string
  onBack: () => void
}

type TabKey =
  | 'documents'
  | 'simple'
  | 'query'
  | 'fields'
  | 'mapping'
  | 'settings'
  | 'alias'
  | 'shards'
  | 'export'
  | 'import'

export default function IndexDetailPanel({
  indexName,
  onBack
}: Props): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('documents')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)

  const mapping = useWorkspaceStore((s) => s.mapping)
  const mappingLoading = useWorkspaceStore((s) => s.mappingLoading)
  const mappingError = useWorkspaceStore((s) => s.mappingError)
  const settings = useWorkspaceStore((s) => s.settings)
  const settingsLoading = useWorkspaceStore((s) => s.settingsLoading)
  const settingsError = useWorkspaceStore((s) => s.settingsError)
  const documentLoading = useWorkspaceStore((s) => s.documentLoading)
  // V0.3.6 B-2: DSL loading is now per-tab. The run button shows
  // the spinner for the active tab; the header refresh button no
  // longer reflects DSL state.
  const simpleLoading = useWorkspaceStore((s) => s.simpleLoading)
  const refreshDetail = useWorkspaceStore((s) => s.refreshIndexDetail)
  const refreshDocuments = useWorkspaceStore((s) => s.refreshDocumentPage)

  // V0.3.4 A-4: per-tab refresh for the Alias panel. Aliases are
  // connection-scoped in the store, so refreshing just re-runs the
  // existing connection fetch and lets the table re-filter.
  const refreshAliases = useWorkspaceStore((s) => s.fetchAliases)
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId)
  const aliasesLoading = useWorkspaceStore((s) => s.aliasesLoading)

  // Header refresh is per-tab so it does the right thing for whichever
  // tab the user is looking at. Mapping/Settings tabs share
  // `refreshIndexDetail`; the 文档 tab refreshes its own page; 简单查询
  // and 查询 tabs have their own submit buttons and are left out of the
  // header action. The Alias tab (V0.3.4 A-4) re-runs the
  // connection-scoped fetch and lets the table re-filter.
  const handleHeaderRefresh = (): void => {
    if (activeTab === 'documents') {
      void refreshDocuments()
    } else if (activeTab === 'mapping' || activeTab === 'settings') {
      void refreshDetail()
    } else if (activeTab === 'alias') {
      if (activeConnectionId) void refreshAliases(activeConnectionId)
    }
  }

  const headerLoading =
    (activeTab === 'documents' && documentLoading) ||
    (activeTab === 'simple' && simpleLoading) ||
    (activeTab === 'mapping' && mappingLoading) ||
    (activeTab === 'settings' && settingsLoading) ||
    (activeTab === 'alias' && aliasesLoading)

  return (
    <Card
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 0,
        border: 0
      }}
      title={
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
            size="small"
          >
            返回索引列表
          </Button>
          <Tooltip title={indexName} placement="topLeft">
            <Title level={4} style={{ margin: 0, maxWidth: 480 }} ellipsis>
              {indexName}
            </Title>
          </Tooltip>
          <Text type="secondary" style={{ fontSize: 12 }}>
            索引详情
          </Text>
        </Space>
      }
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={handleHeaderRefresh}
          loading={headerLoading}
          size="small"
          disabled={
            activeTab === 'query' ||
            activeTab === 'simple' ||
            activeTab === 'export' ||
            activeTab === 'import'
          }
        >
          刷新
        </Button>
      }
      styles={{
        body: {
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden'
        }
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
        className="workspace-tabs"
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        tabBarStyle={{ flex: '0 0 auto', marginBottom: 0, padding: '0 12px' }}
        items={[
          {
            key: 'documents',
            label: '文档',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <DocumentPanel />
              </div>
            )
          },
          {
            key: 'simple',
            label: '简单查询',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <SimpleQueryPanel />
              </div>
            )
          },
          {
            key: 'query',
            label: '查询',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <DslQueryPanel />
              </div>
            )
          },
          {
            key: 'fields',
            label: '字段',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <FieldListPanel />
              </div>
            )
          },
          {
            key: 'mapping',
            label: 'Mapping',
            children: (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}
              >
                {/* V0.3.8 B-5: tree view replaces the raw JSON.
                    The 「追加字段」 button lives outside the tree
                    so the tree component stays presentation-only. */}
                <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setMappingOpen(true)}
                  >
                    追加字段
                  </Button>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <MappingTree
                    data={mapping}
                    loading={mappingLoading}
                    error={mappingError}
                    emptyText="该索引没有 mapping"
                  />
                </div>
              </div>
            )
          },
          {
            key: 'settings',
            label: 'Settings',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <JsonView
                  data={settings}
                  loading={settingsLoading}
                  error={settingsError}
                  emptyText="该索引没有 settings"
                  toolbar={
                    <Button
                      size="small"
                      type="primary"
                      icon={<EditOutlined />}
                      onClick={() => setSettingsOpen(true)}
                    >
                      编辑
                    </Button>
                  }
                />
              </div>
            )
          },
          {
            key: 'alias',
            label: 'Alias',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <AliasPanel indexName={indexName} />
              </div>
            )
          },
          {
            // V0.3.9 E-7: per-index shard table. ShardPanel handles
            // its own refresh on mount and stays current via the
            // actions on each row. The header refresh button on
            // the IndexDetailPanel intentionally skips this tab —
            // ShardPanel's own refresh button is the canonical entry.
            key: 'shards',
            label: '分片',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <ShardPanel indexName={indexName} />
              </div>
            )
          },
          {
            key: 'export',
            label: '导出',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <ExportPanel />
              </div>
            )
          },
          {
            key: 'import',
            label: '导入',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <ImportPanel />
              </div>
            )
          }
        ]}
      />
      <SettingsEditorModal
        open={settingsOpen}
        indexName={indexName}
        onClose={() => setSettingsOpen(false)}
      />
      <MappingEditorModal
        open={mappingOpen}
        indexName={indexName}
        onClose={() => setMappingOpen(false)}
      />
    </Card>
  )
}
