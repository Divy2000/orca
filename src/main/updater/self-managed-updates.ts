import { runProcess } from '../../shared/child-process/run-process'

export const FORK_SYNC_JOB_LABEL = 'com.divy2000.orca-fork-sync'
export const SELF_MANAGED_SYNC_STARTED_MESSAGE =
  'Updates are managed by the fork sync job; sync started.'

const KICKSTART_TIMEOUT_MS = 10_000

export type ForkSyncJobResult = { ok: true } | { ok: false; message: string }

/** Fork builds are replaced by the local sync job, so the upstream updater must stay inert. */
export function isSelfManagedUpdates(): boolean {
  // Why: the runtime override lets tests and a one-off launch flip a build either way.
  const override = process.env.ORCA_SELF_MANAGED_UPDATES
  if (override === '1') {
    return true
  }
  if (override === '0') {
    return false
  }
  return typeof ORCA_SELF_MANAGED_UPDATES !== 'undefined' && ORCA_SELF_MANAGED_UPDATES === true
}

export async function startForkSyncJob(): Promise<ForkSyncJobResult> {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      message: 'The fork sync job runs through launchd and is only available on macOS.'
    }
  }
  const uid = process.getuid?.()
  if (uid === undefined) {
    return { ok: false, message: 'Cannot start the fork sync job: no user id on this platform.' }
  }
  try {
    const result = await runProcess({
      program: 'launchctl',
      args: ['kickstart', `gui/${uid}/${FORK_SYNC_JOB_LABEL}`],
      timeoutMs: KICKSTART_TIMEOUT_MS
    })
    if (result.timedOut) {
      return { ok: false, message: 'Starting the fork sync job timed out.' }
    }
    if (result.code === 0) {
      return { ok: true }
    }
    return {
      ok: false,
      message: result.stderr.trim() || `launchctl exited with code ${result.code}`
    }
  } catch (error) {
    return {
      ok: false,
      message: `Could not start the fork sync job: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
