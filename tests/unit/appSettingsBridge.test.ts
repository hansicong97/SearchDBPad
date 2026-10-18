import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '../../src/shared/ipc'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
}))

vi.mock('electron', () => electron)

await import('../../src/preload/index')
const api = electron.contextBridge.exposeInMainWorld.mock.calls[0][1]

describe('native settings menu bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards only the supported settings payload without exposing the IPC event', () => {
    const callback = vi.fn()
    api.onOpenSettings(callback)
    const [channel, handler] = electron.ipcRenderer.on.mock.calls[0]
    expect(channel).toBe(IpcChannels.AppOpenSettingsEvent)

    handler({ sender: 'private IPC event' }, { section: 'appearance' })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ section: 'appearance' })

    handler({}, undefined)
    handler({}, { section: 'unknown' })
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('removes its own listener on cleanup so remounting does not duplicate notifications', () => {
    const unsubscribe = api.onOpenSettings(vi.fn())
    const [, handler] = electron.ipcRenderer.on.mock.calls[0]
    unsubscribe()
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledTimes(1)
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IpcChannels.AppOpenSettingsEvent,
      handler
    )
  })
})
