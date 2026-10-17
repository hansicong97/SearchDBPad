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

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Skeleton, Space, Tabs, Tooltip, Typography } from 'antd'
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
import IndexMaintenancePanel from './IndexMaintenancePanel'
import JsonView from './JsonView'
import MappingEditorModal from './MappingEditorModal'
import MappingTree from './MappingTree'
import SettingsEditorModal from './SettingsEditorModal'
import ShardPanel from './ShardPanel'
import SimpleQueryPanel from './SimpleQueryPanel'
import { useWorkspaceStore } from '../stores/workspace.store'
import type { SearchEngineCapabilities, SearchEngineType } from '@shared/searchEngine'

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
  | 'maintenance'
  | 'export'
  | 'import'

function supportsTab(
  capabilities: SearchEngineCapabilities | null,
  tab: TabKey,
  engineType?: SearchEngineType
): boolean {
  if (!capabilities) return false
  switch (tab) {
    case 'documents':
    case 'simple':
      // SimpleQueryPanel renders the engine-native query form for Solr,
      // while ES/OpenSearch use their simple DSL form.
      return tab === 'simple'
        ? capabilities.simpleQuery || (engineType === 'solr' && capabilities.documentQuery)
        : capabilities.documentQuery
    case 'query': return capabilities.dslQuery
    case 'fields': return capabilities.schema
    case 'mapping': return capabilities.mappings
    case 'settings': return capabilities.settings
    case 'alias': return capabilities.aliases
    case 'shards': return capabilities.shardManagement
    case 'maintenance': return capabilities.maintenance
    case 'export': return capabilities.bulkTransfer || capabilities.importExport
    case 'import':
      return (
        (capabilities.bulkTransfer || capabilities.importExport) &&
        capabilities.documentWrite
      )
    default: return false
  }
}

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
  const capabilities = useWorkspaceStore((s) => s.capabilities)
  const capabilitiesLoading = useWorkspaceStore((s) => s.capabilitiesLoading)
  const capabilitiesError = useWorkspaceStore((s) => s.capabilitiesError)
  const serverInfo = useWorkspaceStore((s) => s.serverInfo)

  // V0.3.10 F-3: when the workspace navigated here with a
  // pending tab intent (e.g. from the create-and-import flow),
  // apply it once on mount. The intent is then cleared so that
  // later, user-driven tab clicks stay sticky. The effect
  // depends on `indexName` so it re-fires when the user jumps
  // to a different index via the same flow.
  const pendingTab = useWorkspaceStore((s) => s.pendingIndexDetailTab)
  const clearPending = useWorkspaceStore(
    (s) => s.clearPendingIndexDetailIntent
  )
  const availableTabs = useMemo<TabKey[]>(
    () =>
      capabilities
        ? (
            [
              'documents',
              'simple',
              'query',
              'fields',
              'mapping',
              'settings',
              'alias',
              'shards',
              'maintenance',
              'export',
              'import'
            ] as TabKey[]
          ).filter((tab) =>
            supportsTab(capabilities, tab, serverInfo?.engineType)
          )
        : [],
    [capabilities, serverInfo?.engineType]
  )

  useEffect(() => {
    // A pending navigation intent is applied only after capabilities are
    // available. This prevents an import flow from briefly selecting a
    // hidden tab and avoids clearing the intent while capabilities load.
    if (pendingTab && capabilities) {
      setActiveTab(
        availableTabs.includes(pendingTab) ? pendingTab : (availableTabs[0] ?? 'documents')
      )
      clearPending()
      return
    }
    if (capabilities && !availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0] ?? 'documents')
    }
  }, [activeTab, availableTabs, capabilities, clearPending, indexName, pendingTab])

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
            {serverInfo?.engineType === 'solr' ? 'Collection / Core 详情' : '索引详情'}
            {serverInfo?.version ? ` · ${serverInfo.version}` : ''}
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
            !capabilities ||
            activeTab === 'query' ||
            activeTab === 'simple' ||
            activeTab === 'export' ||
            activeTab === 'maintenance'
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
      {capabilitiesLoading ? (
        <div style={{ padding: 24 }}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : capabilitiesError ? (
        <Alert
          type="warning"
          showIcon
          message="无法读取当前引擎能力"
          description="为避免执行不兼容操作，详情页功能已暂时禁用。"
        />
      ) : availableTabs.length === 0 ? (
        <Alert
          type="info"
          showIcon
          message="当前资源没有可用操作"
          description="请检查连接状态和搜索引擎版本。"
        />
      ) : <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
        className="workspace-tabs"
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        tabBarStyle={{ flex: '0 0 auto', marginBottom: 0, padding: '0 12px' }}
        items={[
          ...(supportsTab(capabilities, 'documents') ? [{
            key: 'documents',
            label: '文档',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <DocumentPanel />
              </div>
            )
          }] : []),
          ...(supportsTab(capabilities, 'simple', serverInfo?.engineType) ? [{
            key: 'simple',
            label: serverInfo?.engineType === 'solr' ? 'Solr 查询' : '简单查询',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <SimpleQueryPanel />
              </div>
            )
          }] : []),
          ...(supportsTab(capabilities, 'query') ? [{
            key: 'query',
            label: '查询',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <DslQueryPanel />
              </div>
            )
          }] : []),
          ...(supportsTab(capabilities, 'fields') ? [{
            key: 'fields',
            label: '字段',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <FieldListPanel />
              </div>
            )
          }] : []),
          ...(supportsTab(capabilities, 'mapping') ? [{
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
                {capabilities?.indexManagement && capabilities.documentWrite ? (
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
                ) : null}
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
          }] : []),
          ...(supportsTab(capabilities, 'settings') ? [{
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
                    capabilities?.indexManagement && capabilities.documentWrite ? (
                      <Button
                        size="small"
                        type="primary"
                        icon={<EditOutlined />}
                        onClick={() => setSettingsOpen(true)}
                      >
                        编辑
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )
          }] : []),
          ...(supportsTab(capabilities, 'alias') ? [{
            key: 'alias',
            label: 'Alias',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <AliasPanel indexName={indexName} />
              </div>
            )
          }] : []),
          ...(supportsTab(capabilities, 'shards') ? [{
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
          }] : []),
          ...(supportsTab(capabilities, 'maintenance') ? [{
            // V0.3.12: Refresh / Flush / Force Merge / Clear Cache。
            // 本 tab 没有可刷新的只读数据，头部刷新按钮保持禁用。
            key: 'maintenance',
            label: '维护',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <IndexMaintenancePanel indexName={indexName} />
              </div>
            )
          }] : []),
          ...(supportsTab(capabilities, 'export') ? [{
            key: 'export',
            label: '导出',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <ExportPanel />
              </div>
            )
          }] : []),
          ...(supportsTab(capabilities, 'import') ? [{
            key: 'import',
            label: '导入',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <ImportPanel />
              </div>
            )
          }] : [])
        ]}
      />}
      {supportsTab(capabilities, 'settings') ? (
        <SettingsEditorModal
          open={settingsOpen}
          indexName={indexName}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {supportsTab(capabilities, 'mapping') ? (
        <MappingEditorModal
          open={mappingOpen}
          indexName={indexName}
          onClose={() => setMappingOpen(false)}
        />
      ) : null}
    </Card>
  )
}
