import { Layout, Space, Typography } from 'antd'

const { Header } = Layout
const { Title, Text } = Typography

function AppHeader(): JSX.Element {
  return (
    <Header
      style={{
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        height: 56
      }}
    >
      <Space align="center" size="middle">
        <Title level={4} style={{ margin: 0 }}>
          SearchDBPad
        </Title>
        <Text type="secondary">搜索引擎数据管理桌面客户端</Text>
      </Space>
    </Header>
  )
}

export default AppHeader
