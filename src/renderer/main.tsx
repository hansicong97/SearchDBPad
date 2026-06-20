import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntdApp, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useThemeStore } from './stores/theme.store'
import App from './App'
import './styles/global.css'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element #root not found in index.html')
}

/**
 * Root wrapper that wires the theme store into AntD's ConfigProvider.
 *
 * `cssVar: true` is required so AntD exposes design tokens as
 * `--ant-*` CSS variables — the rest of the app references them in
 * inline styles instead of hardcoded hex literals.
 * `hashed: false` suppresses the per-component hash class names that
 * cssVar mode otherwise generates.
 *
 * The data-theme attribute on <html> is mirrored from the store so any
 * non-React surface (Monaco, future iframes, OS chrome) can sync.
 */
function Root(): JSX.Element {
  const mode = useThemeStore((s) => s.mode)
  const isDark = mode === 'dark'

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = mode
  }

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        cssVar: true,
        hashed: false,
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff' }
      }}
    >
      <AntdApp style={{ height: '100%', overflow: 'hidden' }}>
        <App />
      </AntdApp>
    </ConfigProvider>
  )
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)