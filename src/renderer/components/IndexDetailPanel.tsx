/**
 * Index detail panel (phase 4 + 5 + 6 + 7 + 8 + 9 + layout fix in 13).
 *
 * Shown in the workspace when an index is selected. Seven tabs:
 *   - 文档      (phase 5) — paginated document table, default match_all
 *   - 简单查询  (phase 6) — single-clause form query
 *   - 查询      (phase 5) — Monaco JSON editor for arbitrary DSL queries
 *   - Mapping   (phase 4) — GET /{index}/_mapping
 *   - Settings  (phase 4) — GET /{index}/_settings
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
 */

import { useState } from 'react'
import { Button, Card, Space, Tabs, Tooltip, Typography } from 'antd'
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons'
import DocumentPanel from './DocumentPanel'
import DslQueryPanel from './DslQueryPanel'
import ExportPanel from './ExportPanel'
import ImportPanel from './ImportPanel'
import JsonView from './JsonView'
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
  | 'mapping'
  | 'settings'
  | 'export'
  | 'import'

export default function IndexDetailPanel({
  indexName,
  onBack
}: Props): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('documents')

  const mapping = useWorkspaceStore((s) => s.mapping)
  const mappingLoading = useWorkspaceStore((s) => s.mappingLoading)
  const mappingError = useWorkspaceStore((s) => s.mappingError)
  const settings = useWorkspaceStore((s) => s.settings)
  const settingsLoading = useWorkspaceStore((s) => s.settingsLoading)
  const settingsError = useWorkspaceStore((s) => s.settingsError)
  const documentLoading = useWorkspaceStore((s) => s.documentLoading)
  const dslLoading = useWorkspaceStore((s) => s.dslLoading)
  const simpleLoading = useWorkspaceStore((s) => s.simpleLoading)
  const refreshDetail = useWorkspaceStore((s) => s.refreshIndexDetail)
  const refreshDocuments = useWorkspaceStore((s) => s.refreshDocumentPage)

  // Header refresh is per-tab so it does the right thing for whichever
  // tab the user is looking at. Mapping/Settings tabs share
  // `refreshIndexDetail`; the 文档 tab refreshes its own page; 简单查询
  // and 查询 tabs have their own submit buttons and are left out of the
  // header action.
  const handleHeaderRefresh = (): void => {
    if (activeTab === 'documents') {
      void refreshDocuments()
    } else if (activeTab === 'mapping' || activeTab === 'settings') {
      void refreshDetail()
    }
  }

  const headerLoading =
    (activeTab === 'documents' && documentLoading) ||
    (activeTab === 'simple' && simpleLoading) ||
    (activeTab === 'mapping' && mappingLoading) ||
    (activeTab === 'settings' && settingsLoading) ||
    (activeTab === 'query' && dslLoading)

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
            key: 'mapping',
            label: 'Mapping',
            children: (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <JsonView
                  data={mapping}
                  loading={mappingLoading}
                  error={mappingError}
                  emptyText="该索引没有 mapping"
                />
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
                />
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
    </Card>
  )
}
