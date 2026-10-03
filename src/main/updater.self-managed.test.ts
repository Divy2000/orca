import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type * as SelfManagedUpdates from './updater/self-managed-updates'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'

const { startForkSyncJobMock } = vi.hoisted(() => ({ startForkSyncJobMock: vi.fn() }))

const {
  appMock,
  autoUpdaterMock,
  isMock,
  powerMonitorOnMock,
  fetchNudgeMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('@electron-toolkit/utils', () => moduleFactories.electronToolkitUtils())
vi.mock('./ipc/pty', () => moduleFactories.ipcPty())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())
vi.mock('./updater/self-managed-updates', async (importOriginal) => ({
  ...(await importOriginal<typeof SelfManagedUpdates>()),
  startForkSyncJob: startForkSyncJobMock
}))

warmUpdaterModule()

const DAY_MS = 24 * 60 * 60 * 1000

function asBrowserWindow(window: { webContents: { send: unknown } }): BrowserWindow {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the updater only calls webContents.send on this stub.
  return window as unknown as BrowserWindow
}

function sentStatuses(sendMock: ReturnType<typeof vi.fn>): unknown[] {
  return sendMock.mock.calls
    .filter(([channel]) => channel === 'updater:status')
    .map(([, status]) => status)
}

describe('updater in self-managed mode', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    vi.useFakeTimers()
    vi.stubEnv('ORCA_SELF_MANAGED_UPDATES', '1')
    startForkSyncJobMock.mockReset().mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('never configures electron-updater or schedules checks at startup', async () => {
    const sendMock = vi.fn()
    const mainWindow = { webContents: { send: sendMock } }
    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater(asBrowserWindow(mainWindow), { getLastUpdateCheckAt: () => null })
    await vi.advanceTimersByTimeAsync(3 * DAY_MS)

    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.on).not.toHaveBeenCalled()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(fetchNudgeMock).not.toHaveBeenCalled()
    expect(powerMonitorOnMock).not.toHaveBeenCalled()
    expect(appMock.on).not.toHaveBeenCalledWith('browser-window-focus', expect.anything())
    expect(sentStatuses(sendMock)).toEqual([])
  })

  it('ignores explicit background, download and install requests', async () => {
    const mainWindow = { webContents: { send: vi.fn() } }
    const { setupAutoUpdater, checkForUpdates, downloadUpdate, quitAndInstall } =
      await loadUpdaterModule()
    setupAutoUpdater(asBrowserWindow(mainWindow))

    checkForUpdates()
    downloadUpdate()
    quitAndInstall()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })

  it('starts the fork sync job on a manual check and reports a managed-updates status', async () => {
    const sendMock = vi.fn()
    const mainWindow = { webContents: { send: sendMock } }
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
    setupAutoUpdater(asBrowserWindow(mainWindow))

    checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)

    expect(startForkSyncJobMock).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    const statuses = sentStatuses(sendMock)
    expect(statuses[0]).toEqual({ state: 'checking', userInitiated: true })
    expect(statuses.at(-1)).toEqual({
      state: 'not-available',
      userInitiated: true,
      message: 'Updates are managed by the fork sync job; sync started.'
    })
  })

  it('does not honor pinned or local-build menu checks against the upstream feed', async () => {
    const mainWindow = { webContents: { send: vi.fn() } }
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
    setupAutoUpdater(asBrowserWindow(mainWindow))

    checkForUpdatesFromMenu({ includePrerelease: true })
    checkForUpdatesFromMenu({ channel: 'rc', targetTag: 'v1.0.0-rc.1' })
    checkForUpdatesFromMenu({ localBuild: true })
    await vi.advanceTimersByTimeAsync(0)

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
  })

  it('surfaces the kickstart failure message as an error status', async () => {
    startForkSyncJobMock.mockResolvedValue({
      ok: false,
      message: 'Could not find service "com.divy2000.orca-fork-sync" in domain for user gui: 501'
    })
    const sendMock = vi.fn()
    const mainWindow = { webContents: { send: sendMock } }
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
    setupAutoUpdater(asBrowserWindow(mainWindow))

    checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)

    expect(sentStatuses(sendMock).at(-1)).toEqual({
      state: 'error',
      message: 'Could not find service "com.divy2000.orca-fork-sync" in domain for user gui: 501',
      userInitiated: true
    })
  })

  it('answers a manual check even in an unpackaged build', async () => {
    appMock.isPackaged = false
    isMock.dev = true
    const sendMock = vi.fn()
    const mainWindow = { webContents: { send: sendMock } }
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
    setupAutoUpdater(asBrowserWindow(mainWindow))

    checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)

    expect(startForkSyncJobMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a second manual check while the sync job is starting', async () => {
    let finish: (value: { ok: true }) => void = () => {}
    startForkSyncJobMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const mainWindow = { webContents: { send: vi.fn() } }
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
    setupAutoUpdater(asBrowserWindow(mainWindow))

    checkForUpdatesFromMenu()
    checkForUpdatesFromMenu()
    finish({ ok: true })
    await vi.advanceTimersByTimeAsync(0)

    expect(startForkSyncJobMock).toHaveBeenCalledTimes(1)
  })
})

describe('updater with self-managed mode off', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    vi.useFakeTimers()
    vi.stubEnv('ORCA_SELF_MANAGED_UPDATES', '')
    startForkSyncJobMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('still checks the upstream feed on a manual check without touching the sync job', async () => {
    const mainWindow = { webContents: { send: vi.fn() } }
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
    setupAutoUpdater(asBrowserWindow(mainWindow), { getLastUpdateCheckAt: () => Date.now() })

    checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)

    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
    expect(startForkSyncJobMock).not.toHaveBeenCalled()
  })
})
