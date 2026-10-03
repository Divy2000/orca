import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { runProcessMock } = vi.hoisted(() => ({ runProcessMock: vi.fn() }))

vi.mock('../../shared/child-process/run-process', () => ({ runProcess: runProcessMock }))

import { FORK_SYNC_JOB_LABEL, isSelfManagedUpdates, startForkSyncJob } from './self-managed-updates'

const originalGetuid = Object.getOwnPropertyDescriptor(process, 'getuid')
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function stubUid(uid: number | undefined): void {
  Object.defineProperty(process, 'getuid', {
    value: uid === undefined ? undefined : () => uid,
    configurable: true,
    writable: true
  })
}

describe('isSelfManagedUpdates', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is off when neither the build constant nor the runtime override is set', () => {
    vi.stubEnv('ORCA_SELF_MANAGED_UPDATES', '')
    expect(isSelfManagedUpdates()).toBe(false)
  })

  it('is on when the runtime override is 1', () => {
    vi.stubEnv('ORCA_SELF_MANAGED_UPDATES', '1')
    expect(isSelfManagedUpdates()).toBe(true)
  })

  it('is on when the build constant was compiled in as true', () => {
    vi.stubEnv('ORCA_SELF_MANAGED_UPDATES', '')
    vi.stubGlobal('ORCA_SELF_MANAGED_UPDATES', true)
    try {
      expect(isSelfManagedUpdates()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('lets a runtime override of 0 switch a self-managed build back off', () => {
    vi.stubEnv('ORCA_SELF_MANAGED_UPDATES', '0')
    vi.stubGlobal('ORCA_SELF_MANAGED_UPDATES', true)
    try {
      expect(isSelfManagedUpdates()).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('startForkSyncJob', () => {
  beforeEach(() => {
    runProcessMock.mockReset()
    stubUid(501)
    stubPlatform('darwin')
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    if (originalGetuid) {
      Object.defineProperty(process, 'getuid', originalGetuid)
    } else {
      Reflect.deleteProperty(process, 'getuid')
    }
  })

  it('kickstarts the sync job in the current user gui domain', async () => {
    runProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false
    })

    await expect(startForkSyncJob()).resolves.toEqual({ ok: true })

    expect(runProcessMock).toHaveBeenCalledTimes(1)
    expect(runProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'launchctl',
        args: ['kickstart', `gui/501/${FORK_SYNC_JOB_LABEL}`]
      })
    )
    expect(FORK_SYNC_JOB_LABEL).toBe('com.divy2000.orca-fork-sync')
  })

  it('reports launchctl stderr when the job is not installed', async () => {
    runProcessMock.mockResolvedValue({
      code: 113,
      signal: null,
      stdout: '',
      stderr: 'Could not find service "com.divy2000.orca-fork-sync" in domain for user gui: 501\n',
      timedOut: false
    })

    const result = await startForkSyncJob()

    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('Could not find service "com.divy2000.orca-fork-sync"')
    })
  })

  it('falls back to the exit code when launchctl prints nothing', async () => {
    runProcessMock.mockResolvedValue({
      code: 5,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false
    })

    const result = await startForkSyncJob()

    expect(result).toEqual({ ok: false, message: expect.stringContaining('exited with code 5') })
  })

  it('reports a timeout instead of success', async () => {
    runProcessMock.mockResolvedValue({
      code: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      timedOut: true
    })

    const result = await startForkSyncJob()

    expect(result).toEqual({ ok: false, message: expect.stringContaining('timed out') })
  })

  it('reports a spawn failure message', async () => {
    runProcessMock.mockRejectedValue(new Error('spawn launchctl ENOENT'))

    await expect(startForkSyncJob()).resolves.toEqual({
      ok: false,
      message: expect.stringContaining('spawn launchctl ENOENT')
    })
  })

  it('fails without spawning when the platform has no uid', async () => {
    stubUid(undefined)

    const result = await startForkSyncJob()

    expect(result.ok).toBe(false)
    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('fails without spawning on platforms that have no launchd', async () => {
    stubPlatform('linux')

    const result = await startForkSyncJob()

    expect(result).toEqual({ ok: false, message: expect.stringContaining('macOS') })
    expect(runProcessMock).not.toHaveBeenCalled()
  })
})
