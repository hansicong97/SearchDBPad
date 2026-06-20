/**
 * Top header bar.
 *
 * Renders the product title on the left and a theme toggle button on
 * the right. The toggle reads `useThemeStore`; clicking it switches
 * between light and dark mode globally through the AntD ConfigProvider
 * in `main.tsx`.
 */

import { Button, Layout, Space, Tooltip, Typography } from 'antd'
import { BulbFilled, BulbOutlined } from '@ant-design/icons'
import { useThemeStore } from '../stores/theme.store'

const { Header } = Layout
const { Title, Text } = Typography

function AppHeader(): JSX.Element {
  const mode = useThemeStore((s) => s.mode)
  const toggle = useThemeStore((s) => s.toggle)
  const isDark = mode === 'dark'

  return (
    <Header
      style={{
        background: 'var(--ant-color-bg-container)',
        borderBottom: '1px solid var(--ant-color-border-secondary)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        height: 56,
        lineHeight: '56px',
        flex: '0 0 56px'
      }}
    >
      <Space align="center" size="middle">
        <Title level={4} style={{ margin: 0 }}>
          SearchDBPad
        </Title>
        <Text type="secondary">搜索引擎数据管理桌面客户端</Text>
      </Space>
      <div style={{ flex: 1 }} />
      <Tooltip title={isDark ? '切换为浅色模式' : '切换为深色模式'}>
        <Button
          type="text"
          icon={isDark ? <BulbFilled /> : <BulbOutlined />}
          onClick={toggle}
          aria-label="切换主题"
        />
      </Tooltip>
    </Header>
  )
}

export default AppHeader