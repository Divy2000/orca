import { app, ipcMain, powerMonitor, session } from 'electron'
import { is } from '@electron-toolkit/utils'
import os from 'node:os'
import { join } from 'node:path'
import { maybeRedirectCliLaunch } from './cli-launch-redirect'
import { runProfileStateRecoveryPreflight } from './profile-state-recovery-preflight'
import { argvRequestsServeMode, normalizeServeModeArgv } from './serve-mode-argv'
import {
  configureDevUserDataPath,
  configureElectronNetworkCompatibility,
  configureOrcaUserDataPathEnv,
  disableUnsupportedChromiumFeatures,
  enableMainProcessGpuFeatures,
  installDevParentDisconnectQuit,
  installDevParentSignalQuit,
  installDevParentWatchdog,
  patchPackagedProcessPath,
  optOutOfHiddenPageWakeUpThrottling
} from './configure-process'
import { installServeSupervisorDisconnectQuit } from '../serve-update-handoff'
import {
  installUncaughtPipeErrorGuard,
  installUnhandledRejectionLogging
} from './main-process-error-guards'
import { hydrateShellPath, mergePathSegments } from './hydrate-shell-path'
import { configureRemoteServerUpdater } from '../runtime/remote-server-updater'
import {
  getRemoteServerUpdaterSnapshot,
  checkForRemoteServerUpdate,
  downloadRemoteServerUpdate,
  installRemoteServerUpdate,
  isQuittingForUpdate
} from '../updater'
import { getDevInstanceIdentity, shouldApplyPreReadyAppName } from './dev-instance-identity'
import { enableRendererHeapHeadroom } from './renderer-heap-headroom'
import { configureLinuxDevShmUsage } from './linux-dev-shm-policy'
import { isStartupDiagnosticsEnabled, logStartupDiagnostic } from './startup-diagnostics'
import { startEventLoopStallProbe } from './event-loop-stall-probe'
import {
  isMainThreadDiagnosticsEnabled,
  recordSubprocessSpawn,
  startMainThreadChurnProbe
} from '../diagnostics/main-thread-churn-probe'
import { setSpawnObserver } from '../../shared/child-process/spawn-observer'
import { settledDiffCache } from '../git/source-control/git-read-cache-invalidation'
import { reserveServeStdoutForReadiness } from '../server/serve-stdout-boundary'
import { acquireDesktopProfileInstanceLock } from './desktop-profile-instance-lock'
import { createServeDesktopActivationGate } from './serve-desktop-activation'
import {
  shouldBypassSingleInstanceLock,
  shouldSkipSingleInstanceLock,
  acquireSingleInstanceLock,
  logSingleInstanceLockBypass,
  logSingleInstanceLockFailure,
  SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
} from './single-instance-lock'
import { setAppEnvironment } from '../../shared/app-environment'
import { ElectronAppEnvironment } from '../host/electron-app-environment'
import { installMainProcessTreeKillGate } from '../own-chromium-tree-kill-guard'
import { setSecretStore } from '../../shared/secret-store'
import { ElectronSecretStore } from '../host/electron-secret-store'
import { selectLinuxKeyringBackend } from './select-linux-keyring-backend'
import { setPtyHostBindings } from '../ipc/pty-host-bindings'
import { electronRuntimeDesktopSurface } from '../host/electron-runtime-desktop-surface'
import { setRuntimeDesktopSurface } from '../runtime/runtime-desktop-surface'
import { electronRuntimeBrowserCommandsFactory } from '../host/electron-browser-commands'
import { setRuntimeBrowserCommandsFactory } from '../runtime/runtime-browser-commands-factory'
import { electronHttpClient } from '../host/electron-http-client'
import { setMainHttpClient } from '../network/http-client'
import { electronSpeechServiceFactories } from '../host/electron-speech-services'
import { setSpeechServiceFactories } from '../speech/speech-runtime-service'
import { setWorktreeWatcherRemoval } from '../ipc/worktree-watcher-removal'
import { desktopWorktreeWatcherRemoval } from '../ipc/filesystem-watcher'
import { setDefaultProxySessionResolver } from '../network/proxy-settings'
import { initDataPath, getCanonicalUserDataPath } from '../persistence'
import { applyMacPressAndHoldDefaultAtStartup } from '../macos-press-and-hold-default'
import { initSessionParseCachePersistence } from '../ai-vault/session-parse-cache-persistence'
import { initOrcaProfilePaths } from '../orca-profiles/profile-index-store'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { recoverPendingProfileProjectMoves } from '../orca-profiles/profile-project-move-intent'
import { initStatsPath } from '../stats/collector'
import { initClaudeUsagePath } from '../claude-usage/store'
import { initCodexUsagePath } from '../codex-usage/store'
import { initOpenCodeUsagePath } from '../opencode-usage/store'
import { initMuseUsagePath } from '../muse-usage/store'
import { registerDocPreviewSchemePrivileges } from '../browser/doc-preview-protocol'
import { startCrashpadCapture } from '../crash-reporting/crashpad-capture'
import { CrashReportStore } from '../crash-reporting/crash-report-store'
import { recordCrashBreadcrumb } from '../crash-reporting/crash-breadcrumb-store'
import { recordDurableCrashBreadcrumb } from '../crash-reporting/durable-crash-breadcrumb'
import { GpuCrashDiagnosticsRecorder } from '../crash-reporting/gpu-crash-diagnostics'
import { getMainProcessLifecycleIdentity } from '../crash-reporting/main-process-lifecycle-identity'
import {
  ensureVirtualDisplayForHeadlessServe,
  hasUsableLinuxDisplay,
  MISSING_LINUX_DISPLAY_MESSAGE
} from './ensure-virtual-display'
import { maybeApplyGpuFallbackForThisLaunch, registerGpuLifecycleHandlers } from './gpu-lifecycle'
import { mainProcessState as state } from './main-process-state'
import { initializeSyntheticTitleRuntime } from './synthetic-title-runtime'
import { initializeBrowserProcessUserAgent } from '../browser/browser-process-user-agent'
import { initializeBrowserIdentityModeStore } from '../browser/browser-identity-mode-store'
import { acquireProfileStateRuntimeAdmission } from '../persistence/profile-state/profile-state-access'
import { getActiveProfileStateLocation } from '../persistence/profile-state/profile-state-active-location'
import { handleMainProcessPreflightFailure } from './main-process-preflight-failure'

export type MainProcessPreflightOptions = {
  focusExistingWindow: () => void
  requestDesktopActivation: (argv?: readonly string[]) => void
}

/** Performs all module-scope work that must happen before Electron's ready event. */
export function runMainProcessPreflight(options: MainProcessPreflightOptions): boolean {
  try {
    return initializeMainProcessPreflight(options)
  } catch (error) {
    console.error('[startup] Preflight failed:', error)
    handleMainProcessPreflightFailure(error)
    return false
  }
}

function initializeMainProcessPreflight(options: MainProcessPreflightOptions): boolean {
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 1 })
  if (runProfileStateRecoveryPreflight()) {
    return false
  }
  // Why: on Windows a CLI launch that lost ELECTRON_RUN_AS_NODE would boot the GUI and exit silently; redirect to node mode before the lock gate below.
  // The redirect runs before the serve-argv rewrite so it still matches on the launch argv verbatim.
  // Direct serve stays in-process so its signal handlers own all children.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 2 })
  const cliLaunchRedirect = maybeRedirectCliLaunch({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath
  })
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 3 })
  if (cliLaunchRedirect.redirected) {
    app.exit(cliLaunchRedirect.status)
  }
  // Why: extracted AppRun / binary launches can land CLI-form `serve` args on the
  // Electron process without the CLI rewrite that injects `--serve` (#12677).
  // Guarded so a normal GUI launch keeps its original argv array identity.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 4 })
  if (argvRequestsServeMode(process.argv)) {
    process.argv = normalizeServeModeArgv(process.argv)
  }
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 5 })
  state.isServeMode = process.argv.includes('--serve')
  // Fail before Chromium's missing-display teardown can segfault (#13719).
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 6 })
  if (app.isPackaged && !state.isServeMode && !hasUsableLinuxDisplay()) {
    process.stderr.write(`${MISSING_LINUX_DISPLAY_MESSAGE}\n`)
    app.exit(1)
  }
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 7 })
  if (state.isServeMode) {
    reserveServeStdoutForReadiness()
  }
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 8 })
  state.devInstanceIdentity = getDevInstanceIdentity(is.dev)
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 9 })
  state.devAgentHookEndpointNamespace = state.devInstanceIdentity.isDev
    ? state.devInstanceIdentity.appUserModelId
    : undefined
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 10 })
  state.desktopActivationGate = createServeDesktopActivationGate({
    // Why held for desktop too: an activation before the startup window exists would open a
    // second main window and abort launch; runtime launch releases it once that window exists.
    initialState: 'initializing',
    activateWindow: () => {
      // Why: an updater replacement must not resurrect the old app bundle.
      if (!isQuittingForUpdate()) {
        options.focusExistingWindow()
      }
    },
    onBlocked: (reason) => console.error(`[serve] Desktop activation blocked: ${reason}`)
  })
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 11 })
  installUncaughtPipeErrorGuard()
  // Why (issue #9441): without this, one rejected background promise during startup restore kills main silently (exit 1, no crash report).
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 12 })
  installUnhandledRejectionLogging()
  // Why: expose the app version via process.env so main and the forked daemon can set TERM_PROGRAM_VERSION without importing electron.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 13 })
  process.env.ORCA_APP_VERSION = app.getVersion()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 14 })
  configureRemoteServerUpdater({
    getSnapshot: getRemoteServerUpdaterSnapshot,
    check: checkForRemoteServerUpdate,
    download: downloadRemoteServerUpdate,
    install: installRemoteServerUpdate
  })
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 15 })
  patchPackagedProcessPath()
  // Why: the sync seed above covers early IPC (homebrew/nix); the async login-shell probe below (packaged only) then adds the user's rc PATH.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 16 })
  if (app.isPackaged && process.platform !== 'win32') {
    void hydrateShellPath().then((result) => {
      if (result.ok) {
        mergePathSegments(result.segments)
      } else {
        // Why: on failure the seeded fallbacks stay in front. For an nvm user that is
        // now their `default` version rather than the newest install, so it is usually
        // survivable — but it is still not what their shell would have resolved. Name
        // the reason so it shows up in a log bundle instead of as a missing CLI.
        console.warn(
          `[shell-path] login-shell probe failed (${result.failureReason}); using seeded PATH`
        )
      }
    })
  }
  // Why before any spawn: `signalProcessTree` is shared with the CLI and relay, so
  // it can only reach the main-process guard and breadcrumb store once this is registered.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 17 })
  installMainProcessTreeKillGate()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 18 })
  const isDev = is.dev
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 19 })
  configureDevUserDataPath(isDev)
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 20 })
  configureOrcaUserDataPathEnv()
  // Why these four lines are one step (#16761): the two above decide where userData lives, and
  // everything below may resolve a path. Installing the accessor any later leaves a window where an
  // early resolve either throws — which is what killed `orca serve` — or, worse, memoizes the
  // pre-override directory and silently writes user state to the wrong place for the whole session.
  // Safe this early: ElectronAppEnvironment holds no state and calls `app` lazily per accessor, so it
  // changes no timing, and initDataPath only joins strings.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 21 })
  setAppEnvironment(new ElectronAppEnvironment())
  // Why captured now: after the dev/E2E override above, and before app.setName('Orca') (whenReady)
  // changes how userData resolves on a case-sensitive filesystem. See persistence.ts:20-28.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 22 })
  initDataPath()
  // Why: Electron resolves the macOS safeStorage Keychain service name from the app name before
  // ready. Dev pins userData above, so applying its name here cannot shift the captured path.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 23 })
  if (state.devInstanceIdentity && shouldApplyPreReadyAppName(state.devInstanceIdentity)) {
    app.setName(state.devInstanceIdentity.appName)
  }
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 24 })
  state.startupDiagnosticsEnabled = isStartupDiagnosticsEnabled()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 25 })
  if (state.startupDiagnosticsEnabled) {
    logStartupDiagnostic('before-single-instance-lock', {
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      osRelease: os.release(),
      userData: app.getPath('userData'),
      e2eUserData: Boolean(process.env.ORCA_E2E_USER_DATA_DIR)
    })
    startEventLoopStallProbe()
  }
  // Self-gated on ORCA_MAIN_THREAD_DIAGNOSTICS; runs the whole session to catch steady-state churn (issue #7576).
  // Why the diff-cache counters ride along: a stamp the filesystem reports unstably makes the cache
  // look exactly like a cold start, and only the hit/miss/unprovable split tells the two apart.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 26 })
  if (isMainThreadDiagnosticsEnabled()) {
    // Why here too: the probe's own call sites only cover src/main/git, so without
    // this every spawnProcess/runProcess child (rg, ps, pty helpers) is invisible.
    setSpawnObserver(recordSubprocessSpawn)
  }
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 27 })
  startMainThreadChurnProbe({ extraStats: () => ({ diffCache: settledDiffCache.stats() }) })
  // Why: acquire AFTER configureDevUserDataPath — Electron derives lock identity from `userData`, so dev/packaged lock in separate namespaces.
  // Why dev locks too: two processes on one profile corrupt its stores (PR #1326 / #1312); parallel `pnpm dev` needs ORCA_DEV_USER_DATA_PATH per copy.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 28 })
  const bypass = shouldBypassSingleInstanceLock({ isDev, isServeMode: state.isServeMode })
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 29 })
  const skip = shouldSkipSingleInstanceLock({ isDev, isServeMode: state.isServeMode })
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 30 })
  if (bypass) {
    // Why: diagnostic escape hatch for macOS builds where Electron reports a false lock loss before any app logs exist.
    logSingleInstanceLockBypass()
  }
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 31 })
  const hasLock = skip || bypass || acquireSingleInstanceLock(app, options.requestDesktopActivation)
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 32 })
  if (state.startupDiagnosticsEnabled) {
    logStartupDiagnostic('single-instance-lock-result', {
      acquired: hasLock,
      bypassed: bypass,
      skippedForE2E: skip
    })
  }
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 33 })
  if (!hasLock) {
    // Why: a false-negative lock loss otherwise looks like a silent crash on packaged macOS; `open --stderr` can capture this line.
    // In dev it is the line `pnpm dev` prints before exiting.
    logSingleInstanceLockFailure({
      isDevDesktop: isDev && !state.isServeMode,
      userDataPath: app.getPath('userData')
    })
    // Why: a graceful quit is deferred pre-ready, so this launch would still walk into Linux display init and SIGSEGV (#11935).
    app.exit(SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE)
    return false
  }
  // Why after Electron's lock: that one fences other desktops; this one fences orcad `orca serve`.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 34 })
  if (!skip && !bypass) {
    const profileLock = acquireDesktopProfileInstanceLock(getCanonicalUserDataPath())
    if (profileLock.state === 'held') {
      app.exit(SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE)
      return false
    }
  }
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 35 })
  state.profileStateAdmission = acquireProfileStateRuntimeAdmission(getCanonicalUserDataPath())
  // Renderer and worker defaults must be fixed before any session exists.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 36 })
  initializeBrowserProcessUserAgent(
    initializeBrowserIdentityModeStore(getCanonicalUserDataPath()).appliedMode
  )
  // Why first in this block: the accessor throws until installed and everything below may read a
  // credential. The constructor does not touch `safeStorage` — it resolves lazily per call — so
  // installing here changes no timing, in particular not the pre-ready Keychain service-name
  // resolution. The app-environment port and the userData capture install earlier still, next to
  // the path decision they depend on.
  // Why immediately before the store is installed, and not later: Electron reads
  // `--password-store` when it builds its os_crypt config during browser main parts,
  // so a switch appended after that is ignored and the desktop keeps writing plaintext.
  // Safe here — nothing above resolves a credential, and the probe inside is bounded.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 37 })
  selectLinuxKeyringBackend()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 38 })
  setSecretStore(new ElectronSecretStore())
  // Why at process level, not per-window: pty.ts registers against injected surfaces so
  // it can load without electron, and an Electron main process always has ipcMain —
  // whether a window exists is irrelevant. Installing this in attachMainWindowServices
  // meant `orca serve` registered its PTY handlers against no-ops before any window
  // attached, so a paired desktop owner never received them.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 39 })
  setPtyHostBindings({ ipc: ipcMain, power: powerMonitor })
  // Why also at process level: the runtime's notification, window-lookup and
  // tab-create-reply channel are desktop-only. A Node host installs none and the
  // runtime routes notifications to paired clients instead.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 40 })
  setRuntimeDesktopSurface(electronRuntimeDesktopSurface)
  // Why here: constructing RuntimeBrowserCommands is what pulls the Chromium browser
  // cluster into the graph. The desktop installs it; a Node host installs none and every
  // browser RPC rejects, which capability filtering already tells clients about.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 41 })
  setRuntimeBrowserCommandsFactory(electronRuntimeBrowserCommandsFactory)
  // Why here: proxy-settings only needed electron for `session.defaultSession`. The
  // desktop supplies it; a Node host has no Chromium proxy config to consult, so the
  // environment variables are the whole answer there.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 42 })
  setDefaultProxySessionResolver(() => session.defaultSession)
  // Why here: integrations use Chromium's network stack on the desktop. A Node host
  // falls back to the platform default, which is a real behavioural difference (proxy
  // read from the environment, Node's user agent) rather than a transparent swap.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 43 })
  setMainHttpClient(electronHttpClient)
  // Why here: constructing the speech services is what pulls Electron's streaming net
  // request in. A host without them rejects speech calls rather than pretending.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 44 })
  setSpeechServiceFactories(electronSpeechServiceFactories)
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 45 })
  setWorktreeWatcherRemoval(desktopWorktreeWatcherRemoval)
  // Why: couple to dev-parent only for electron-vite desktop runs; `orca serve`'s parent (CLI shim/background shell) isn't the intended server lifetime.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 46 })
  const shouldCoupleToDevParent = isDev && !state.isServeMode
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 47 })
  installDevParentDisconnectQuit(shouldCoupleToDevParent)
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 48 })
  installDevParentWatchdog(shouldCoupleToDevParent)
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 49 })
  installDevParentSignalQuit(shouldCoupleToDevParent)
  // Why not at module scope with the other lifetime couplings (#16761): this resolves the handoff
  // path, so it throws until setAppEnvironment() above installs the accessor — which killed every
  // `orca serve` process before it could listen. After initDataPath() specifically, so the
  // path-equality check against the CLI's env var uses the dir captured before app.setName().
  // Safe to defer, and must stay synchronous: no 'disconnect' can be delivered until this module
  // finishes evaluating, so moving this behind an await would open a real orphan window.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 50 })
  installServeSupervisorDisconnectQuit(state.isServeMode)
  // Why here: initDataPath above gives the canonical userData path for the record file; the write
  // itself lands for the next launch (see macos-press-and-hold-default.ts).
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 51 })
  applyMacPressAndHoldDefaultAtStartup(getCanonicalUserDataPath())
  // Why: use the canonical userData path — late app.getPath('userData') can resolve differently across restarts, defeating persistence.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 52 })
  initSessionParseCachePersistence({
    filePath: join(getCanonicalUserDataPath(), 'ai-vault', 'session-parse-cache.json'),
    appVersion: app.getVersion()
  })
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 53 })
  initOrcaProfilePaths()
  // A crash can leave a cross-profile SQLite move between its two commits. Resolve
  // that journal before any Store opens a profile, so no reader observes a half-move.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 54 })
  const profileUserDataPath = getProfileUserDataPath()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 55 })
  recoverPendingProfileProjectMoves(
    profileUserDataPath,
    getActiveProfileStateLocation(profileUserDataPath)?.profileId
  )
  // Why: same timing as initDataPath — capture userData before app.setName changes it. See persistence.ts:20-28.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 56 })
  initStatsPath()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 57 })
  initClaudeUsagePath()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 58 })
  initCodexUsagePath()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 59 })
  initOpenCodeUsagePath()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 60 })
  initMuseUsagePath()
  // Why: Electron freezes the privileged scheme table at ready, so the doc-preview
  // scheme must be declared here or its webview loses fetch/secure-origin privileges.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 61 })
  registerDocPreviewSchemePrivileges()
  // Why: must precede app.whenReady() so Crashpad is installed before the
  // first renderer spawns; a CHECK before this point is still exit-code-only.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 62 })
  startCrashpadCapture()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 63 })
  state.crashReports = CrashReportStore.fromUserData()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 64 })
  state.gpuCrashDiagnostics =
    process.platform === 'win32'
      ? new GpuCrashDiagnosticsRecorder({
          provider: {
            getGPUInfo: (infoType) => app.getGPUInfo(infoType),
            getGPUFeatureStatus: () => app.getGPUFeatureStatus()
          },
          recordBreadcrumb: (data) => recordDurableCrashBreadcrumb('gpu_crash_hardware', data)
        })
      : null
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 65 })
  recordCrashBreadcrumb('app_started', {
    packaged: app.isPackaged,
    platform: process.platform,
    ...getMainProcessLifecycleIdentity()
  })
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 66 })
  disableUnsupportedChromiumFeatures()
  // Why: unconditional — a GPU-fallback launch skips enableMainProcessGpuFeatures() below.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 67 })
  optOutOfHiddenPageWakeUpThrottling()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 68 })
  configureElectronNetworkCompatibility()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 69 })
  enableRendererHeapHeadroom()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 70 })
  configureLinuxDevShmUsage()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 71 })
  maybeApplyGpuFallbackForThisLaunch()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 72 })
  if (!state.gpuFallbackActiveThisLaunch) {
    enableMainProcessGpuFeatures()
  }
  // Why: headless serve's offscreen BrowserWindows need an X display (Xvfb) on Linux; the result gates whether the offscreen backend is installed.
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 73 })
  state.headlessBrowserDisplayAvailable = ensureVirtualDisplayForHeadlessServe({
    isServeMode: state.isServeMode
  })
  // Why: continuing without Xvfb lets Ozone initialize without a display and SIGSEGV (#17615).
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 74 })
  if (state.isServeMode && !state.headlessBrowserDisplayAvailable) {
    process.stderr.write(`${MISSING_LINUX_DISPLAY_MESSAGE}\n`)
    app.exit(1)
  }
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 75 })
  initializeSyntheticTitleRuntime()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 76 })
  registerGpuLifecycleHandlers()
  if (isStartupDiagnosticsEnabled()) logStartupDiagnostic('wip-preflight-step', { n: 77 })
  return true
}
