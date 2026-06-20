/**
 * Workspace page (phase 3 + 4 + 5 + layout fix in 13).
 *
 * Shown in the main content area when a connection is active in the
 * sidebar. Displays:
 *  - the active connection name + refresh
 *  - cluster info card
 *  - either the index list (default) or the index detail panel
 *    (when an index row has been clicked)
 *
 * Layout invariant (per the version 13 update plan):
 *   - The root fills the height of its parent.
 *   - The header row (title + refresh) is fixed at the top.
 *   - Below the header, the right side becomes a flex column:
 *       - ClusterInfoCard stays at its content height.
 *       - The detail / index list fills the remaining height and
 *         scrolls INDEPENDENTLY of the page (the page itself is
 *         overflow:hidden so it never scrolls).
 */

import { useCallback, useEffect } from 'react'
import { App as AntdApp, Button, Card, Empty, Space, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import ClusterInfoCard from '../components/ClusterInfoCard'
import IndexDetailPanel from '../components/IndexDetailPanel'
import IndexList from '../components/IndexList'
import { useConnectionStore } from '../stores/connection.store'
import { useWorkspaceStore } from '../stores/workspace.store'

const { Text, Title } = Typography

export default function WorkspacePage(): JSX.Element {
  const { message } = AntdApp.useApp()

  const activeId = useWorkspaceStore((s) => s.activeConnectionId)
  const refreshAll = useWorkspaceStore((s) => s.refreshAll)
  const clusterLoading = useWorkspaceStore((s) => s.clusterLoading)
  const indicesLoading = useWorkspaceStore((s) => s.indicesLoading)
  const clusterError = useWorkspaceStore((s) => s.clusterError)
  const indicesError = useWorkspaceStore((s) => s.indicesError)
  const selectedIndex = useWorkspaceStore((s) => s.selectedIndex)
  const selectIndex = useWorkspaceStore((s) => s.selectIndex)
  const mappingError = useWorkspaceStore((s) => s.mappingError)
  const mappingLoading = useWorkspaceStore((s) => s.mappingLoading)
  const settingsError = useWorkspaceStore((s) => s.settingsError)
  const settingsLoading = useWorkspaceStore((s) => s.settingsLoading)
  const documentError = useWorkspaceStore((s) => s.documentError)
  const documentLoading = useWorkspaceStore((s) => s.documentLoading)
  const dslError = useWorkspaceStore((s) => s.dslError)
  const dslLoading = useWorkspaceStore((s) => s.dslLoading)
  const simpleError = useWorkspaceStore((s) => s.simpleError)
  const simpleLoading = useWorkspaceStore((s) => s.simpleLoading)

  const connections = useConnectionStore((s) => s.connections)
  const activeConnection = connections.find((c) => c.id === activeId) ?? null

  // Surface IPC errors as a toast (the components themselves already show
  // an inline error in their placeholders).
  useEffect(() => {
    if (clusterError && !clusterLoading) message.error(clusterError)
  }, [clusterError, clusterLoading, message])
  useEffect(() => {
    if (indicesError && !indicesLoading) message.error(indicesError)
  }, [indicesError, indicesLoading, message])
  useEffect(() => {
    if (mappingError && !mappingLoading) message.error(mappingError)
  }, [mappingError, mappingLoading, message])
  useEffect(() => {
    if (settingsError && !settingsLoading) message.error(settingsError)
  }, [settingsError, settingsLoading, message])
  useEffect(() => {
    if (documentError && !documentLoading) message.error(documentError)
  }, [documentError, documentLoading, message])
  useEffect(() => {
    if (dslError && !dslLoading) message.error(dslError)
  }, [dslError, dslLoading, message])
  useEffect(() => {
    if (simpleError && !simpleLoading) message.error(simpleError)
  }, [simpleError, simpleLoading, message])

  const handleSelectIndex = useCallback(
    (name: string) => {
      selectIndex(name)
    },
    [selectIndex]
  )

  const handleBack = useCallback(() => {
    selectIndex(null)
  }, [selectIndex])

  if (!activeId || !activeConnection) {
    return (
      <Card
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          borderRadius: 0,
          border: 0,
          height: '100%'
        }}
        styles={{
          body: {
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%'
          }
        }}
        title={
          <Title level={4} style={{ margin: 0 }}>
            工作台
          </Title>
        }
      >
        <Empty
          description={
            <Space direction="vertical" size={4}>
              <Text strong>请从左侧选择一个连接</Text>
              <Text type="secondary">
                点击某个连接即可进入其工作台，查看集群信息和索引列表。
              </Text>
            </Space>
          }
        />
      </Card>
    )
  }

  const refreshing = clusterLoading || indicesLoading

  return (
    <Card
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 0,
        border: 0
      }}
      title={
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            {activeConnection.name}
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {activeConnection.url}
          </Text>
        </Space>
      }
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void refreshAll()}
          loading={refreshing}
        >
          刷新
        </Button>
      }
      styles={{
        body: {
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          overflow: 'hidden',
          flex: 1,
          minHeight: 0,
          padding: 0
        }
      }}
    >
      <div
        style={{
          flex: '0 0 auto',
          borderBottom: '1px solid var(--ant-color-border-secondary)'
        }}
      >
        <Card
          size="small"
          bordered={false}
          style={{ borderRadius: 0 }}
          styles={{ body: { padding: 12 } }}
        >
          <ClusterInfoCard />
        </Card>
      </div>

      <div
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {selectedIndex ? (
          <IndexDetailPanel indexName={selectedIndex} onBack={handleBack} />
        ) : (
          <IndexList onSelect={handleSelectIndex} />
        )}
      </div>
    </Card>
  )
}
