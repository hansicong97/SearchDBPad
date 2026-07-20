/**
 * Floating button + task list (V0.3.10 F-5 + V0.3.11 G-1/G-2/G-3).
 *
 * A right-bottom floating action button that opens a drawer listing
 * the current-session import / export jobs. Subscribes once to
 * `window.esApi.importDocs.onProgress` and
 * `window.esApi.exportDocs.onProgress` and forwards every event
 * into `useJobTaskStore`, so the panels' own per-page progress
 * cards remain the source of truth for in-page feedback while this
 * component is the cross-page / background view.
 *
 * Wiring:
 *   - The button sits inside the top-level `App.tsx` (mounted for
 *     the whole session) so it survives connection / index /
 *     tab changes. The drawer therefore shows the live state of
 *     every job the renderer has ever heard of in this session.
 *   - V0.3.11 surfaces cooperative Stop for running import/export
 *     jobs. Pause / resume / retry and persistence remain out of
 *     scope.
 *   - Tasks are not persisted: a hard refresh wipes the list,
 *     matching the plan's "no historical task browser" rule.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Badge,
  Button,
  Drawer,
  Empty,
  FloatButton,
  Progress,
  Space,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ImportOutlined,
  LoadingOutlined,
  StopOutlined
} from '@ant-design/icons'
import {
  selectIsJobRunning,
  selectRunningJobCount,
  useJobTaskStore
} from '../stores/jobTask.store'
import type { JobTask, JobTaskKind, JobTaskStage } from '../stores/jobTask.store'

const { Text } = Typography

const IMPORT_STAGE_LABEL: Record<string, string> = {
  reading: '读取文件中',
  parsing: '解析文件中',
  clearing: '清空索引中',
  writing: '写入文档中',
  completed: '已完成',
  failed: '失败'
}

const EXPORT_STAGE_LABEL: Record<string, string> = {
  querying: '查询文档中',
  writing: '写入文件中',
  completed: '已完成',
  failed: '失败'
}

function fileBaseName(p: string): string {
  const norm = p.replace(/\\/g, '/')
  return norm.split('/').pop() ?? p
}

function shortJobId(id: string): string {
  // JobIds are full UUIDs in practice. Trim to the first 8 chars
  // for the row header so the list stays compact; the full id is
  // available in the title attribute for forensic needs.
  return id.length > 8 ? id.slice(0, 8) : id
}

function kindLabel(k: JobTaskKind): string {
  return k === 'import' ? '导入' : '导出'
}

function kindIcon(k: JobTaskKind): JSX.Element {
  return k === 'import' ? <ImportOutlined /> : <DownloadOutlined />
}

function statusTag(stage: JobTaskStage): JSX.Element {
  if (stage === 'running') {
    return <Tag color="processing">运行中</Tag>
  }
  if (stage === 'cancelling') {
    return <Tag color="error" icon={<StopOutlined />}>停止中</Tag>
  }
  if (stage === 'completed') {
    return <Tag color="success" icon={<CheckCircleOutlined />}>已完成</Tag>
  }
  if (stage === 'failed') {
    return <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>
  }
  return <Tag>等待中</Tag>
}

interface TaskRowProps {
  task: JobTask
  onStop: (task: JobTask) => void
  onRemove: (task: JobTask) => void
}

function TaskRow({ task, onStop, onRemove }: TaskRowProps): JSX.Element {
  const isImport = task.kind === 'import'
  const labelMap = isImport ? IMPORT_STAGE_LABEL : EXPORT_STAGE_LABEL
  const rawStage = isImport
    ? task.importProgress?.stage
    : task.exportProgress?.stage
  const stageLabel = task.stage === 'cancelling'
    ? '停止中'
    : rawStage ? labelMap[rawStage] ?? rawStage : '排队中'
  const percent = isImport
    ? task.importProgress?.percent ?? null
    : task.exportProgress?.percent ?? null
  const total = isImport
    ? task.importProgress?.total ?? null
    : task.exportProgress?.total ?? null
  const processed = isImport
    ? task.importProgress?.processed ?? null
    : null
  const success = isImport ? task.importProgress?.success ?? null : null
  const failed = isImport ? task.importProgress?.failed ?? null : null
  const bytes = !isImport ? task.exportProgress?.bytes ?? null : null
  const rows = !isImport ? task.exportProgress?.total ?? null : null
  const message = isImport
    ? task.importProgress?.message
    : task.exportProgress?.message

  const meta = isImport ? task.importMeta : task.exportMeta
  const subtitle = useMemo(() => {
    if (!meta) return '（无元信息）'
    if (isImport) {
      const m = meta as NonNullable<typeof task.importMeta>
      return `${m.index} · ${fileBaseName(m.filePath)} · ${m.format.toUpperCase()}`
    }
    const m = meta as NonNullable<typeof task.exportMeta>
    return `${m.index} → ${fileBaseName(m.outputPath)} · ${m.format.toUpperCase()}`
  }, [meta, isImport])

  const progressPercent = percent ?? (task.stage === 'completed' ? 100 : 0)
  const progressStatus:
    | 'normal'
    | 'success'
    | 'exception'
    | 'active' = task.stage === 'completed'
    ? 'success'
    : task.stage === 'failed' || task.stage === 'cancelling'
      ? 'exception'
      : percent !== null
        ? 'active'
        : 'normal'

  return (
    <div
      style={{
        border: '1px solid var(--ant-color-border-secondary)',
        borderRadius: 6,
        padding: 12,
        background: 'var(--ant-color-bg-container)'
      }}
    >
      <Space style={{ width: '100%' }} direction="vertical" size={6}>
        <Space style={{ width: '100%' }} align="center" wrap>
          {kindIcon(task.kind)}
          <Text strong>{kindLabel(task.kind)}</Text>
          <Tooltip title={task.jobId}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              #{shortJobId(task.jobId)}
            </Text>
          </Tooltip>
          <Tag color={task.stage === 'cancelling' ? 'red' : 'blue'}>{stageLabel}</Tag>
          {statusTag(task.stage)}
          <div style={{ flex: 1 }} />
          {task.stage === 'running' || task.stage === 'cancelling' ? (
            <Tooltip title={task.stage === 'cancelling' ? '停止中' : '停止任务'}>
              <Button
                size="small"
                type="text"
                danger
                icon={<StopOutlined />}
                loading={task.stage === 'cancelling'}
                disabled={task.stage === 'cancelling'}
                onClick={() => onStop(task)}
              />
            </Tooltip>
          ) : null}
          <Tooltip title="从列表中移除">
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => onRemove(task)}
            />
          </Tooltip>
        </Space>

        <Tooltip title={subtitle}>
          <Text
            type="secondary"
            style={{
              fontSize: 12,
              display: 'block',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {subtitle}
          </Text>
        </Tooltip>

        <Progress percent={progressPercent} status={progressStatus} showInfo />

        <Space size="large" wrap>
          {isImport ? (
            <>
              {total !== null ? (
                <Text style={{ fontSize: 12 }}>
                  总计 <Text strong>{total.toLocaleString('en-US')}</Text> 条
                </Text>
              ) : null}
              {processed !== null ? (
                <Text style={{ fontSize: 12 }}>
                  已处理{' '}
                  <Text strong>{processed.toLocaleString('en-US')}</Text>
                </Text>
              ) : null}
              {success !== null ? (
                <Text style={{ fontSize: 12 }}>
                  成功{' '}
                  <Text type="success" strong>
                    {success.toLocaleString('en-US')}
                  </Text>
                </Text>
              ) : null}
              {failed !== null ? (
                <Text style={{ fontSize: 12 }}>
                  失败{' '}
                  <Text type="danger" strong>
                    {failed.toLocaleString('en-US')}
                  </Text>
                </Text>
              ) : null}
            </>
          ) : (
            <>
              {rows !== null ? (
                <Text style={{ fontSize: 12 }}>
                  已导出 <Text strong>{rows.toLocaleString('en-US')}</Text> 条
                </Text>
              ) : null}
              {bytes !== null ? (
                <Text style={{ fontSize: 12 }}>
                  已写入{' '}
                  <Text strong>{(bytes / 1024).toFixed(1)}</Text> KB
                </Text>
              ) : null}
            </>
          )}
        </Space>

        {message ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {message}
          </Text>
        ) : null}
      </Space>
    </div>
  )
}

export default function JobTaskFloatButton(): JSX.Element | null {
  const { modal, message } = AntdApp.useApp()
  const [open, setOpen] = useState(false)
  const tasks = useJobTaskStore((s) => s.tasks)
  const runningCount = useJobTaskStore(selectRunningJobCount)
  const upsertImportProgress = useJobTaskStore(
    (s) => s.upsertImportProgress
  )
  const upsertExportProgress = useJobTaskStore(
    (s) => s.upsertExportProgress
  )
  const cancelTask = useJobTaskStore((s) => s.cancelTask)
  const removeTask = useJobTaskStore((s) => s.removeTask)
  const clearFinished = useJobTaskStore((s) => s.clearFinished)

  // V0.3.10 F-5: single subscription to the main-process progress
  // events, fed straight into the store. The IPC channel names
  // are stable (see `IpcChannels` in `@shared/ipc`) and the
  // `window.esApi` surface already wraps them in a typed callback.
  useEffect(() => {
    const u1 = window.esApi.importDocs.onProgress((p) => {
      upsertImportProgress(p)
    })
    const u2 = window.esApi.exportDocs.onProgress((p) => {
      upsertExportProgress(p)
    })
    return () => {
      u1()
      u2()
    }
  }, [upsertImportProgress, upsertExportProgress])

  const hasFinished = tasks.some(
    (t) => t.stage === 'completed' || t.stage === 'failed'
  )

  const handleStop = async (task: JobTask): Promise<void> => {
    const res = await cancelTask(task.jobId)
    if (!res.success) {
      message.error(res.error?.message ?? '停止任务失败')
    }
  }

  const handleRemove = (task: JobTask): void => {
    if (!selectIsJobRunning(task)) {
      removeTask(task.jobId)
      return
    }

    modal.confirm({
      title: '确认移除并停止任务？',
      content: '该任务仍在运行中，移除后将同时取消任务执行。',
      okText: '取消并移除',
      okButtonProps: { danger: true },
      cancelText: '不移除',
      onOk: async () => {
        const current = useJobTaskStore
          .getState()
          .tasks.find((t) => t.jobId === task.jobId)
        if (current && selectIsJobRunning(current)) {
          const res = await useJobTaskStore.getState().cancelTask(task.jobId)
          if (!res.success) {
            message.error(res.error?.message ?? '停止任务失败')
          }
        }
        useJobTaskStore.getState().removeTask(task.jobId)
      }
    })
  }

  // We deliberately do not gate the FAB on `runningCount` — even
  // with zero in-flight jobs the user should be able to look at
  // the most recent completed / failed task. The badge on the FAB
  // shows only the running count, so it stays meaningful.
  return (
    <>
      <FloatButton
        icon={
          runningCount > 0 ? <LoadingOutlined /> : <ImportOutlined />
        }
        type="primary"
        onClick={() => setOpen(true)}
        style={{ right: 24, bottom: 24 }}
        tooltip={runningCount > 0 ? `运行中：${runningCount}` : '导入/导出任务'}
      >
        {/* Antd FloatButton does not accept a child badge; we
            render the count as a sibling above the button so it
            reads like a notification dot. */}
        {runningCount > 0 ? (
          <Badge
            count={runningCount}
            offset={[-6, 6]}
            style={{ position: 'absolute', top: 0, right: 0 }}
          />
        ) : null}
      </FloatButton>
      <Drawer
        title={
          <Space>
            <Text strong>导入 / 导出任务</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前会话
            </Text>
          </Space>
        }
        placement="right"
        width={420}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose={false}
        extra={
          <Button
            size="small"
            disabled={!hasFinished}
            onClick={() => clearFinished()}
          >
            清除已完成
          </Button>
        }
      >
        {tasks.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text type="secondary" style={{ fontSize: 12 }}>
                本次会话内还没有任务
              </Text>
            }
          />
        ) : (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {tasks.map((task) => (
              <TaskRow
                key={task.jobId}
                task={task}
                onStop={(t) => void handleStop(t)}
                onRemove={handleRemove}
              />
            ))}
          </Space>
        )}
      </Drawer>
    </>
  )
}
