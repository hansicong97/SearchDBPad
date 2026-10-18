import { Button, Form, Modal, Radio, Typography } from 'antd'
import { useThemeStore, type ThemeMode } from '../stores/theme.store'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const THEME_OPTIONS: Array<{ label: string; value: ThemeMode }> = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '跟随系统', value: 'system' }
]

export default function SettingsModal({ open, onClose }: SettingsModalProps): JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const setMode = useThemeStore((state) => state.setMode)

  return (
    <Modal
      title="设置"
      open={open}
      onCancel={onClose}
      width={440}
      footer={<Button type="primary" onClick={onClose}>完成</Button>}
    >
      <Form layout="vertical" style={{ marginTop: 24 }}>
        <Form.Item label="外观主题" style={{ marginBottom: 12 }}>
          <Radio.Group
            aria-label="外观主题"
            value={mode}
            options={THEME_OPTIONS}
            optionType="button"
            buttonStyle="solid"
            onChange={(event) => setMode(event.target.value as ThemeMode)}
          />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          跟随系统时，主题会随系统外观自动切换。
        </Typography.Paragraph>
        <Typography.Text type="secondary">更改立即生效，并在下次启动时保留。</Typography.Text>
      </Form>
    </Modal>
  )
}
