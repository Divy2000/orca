import type { TerminalPaneSplitSource } from '../../../../shared/feature-education-telemetry'
import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import { splitWebRuntimeTerminal } from '@/runtime/web-runtime-session'
import type { PtyTransport } from './pty-transport'
import { resolveSplitCwd, type PaneCwdMap } from './resolve-split-cwd'
import { recordCreatedTerminalPaneSplit } from './terminal-pane-split-completion'
import { useAppStore } from '@/store'
import { getWorktreeMapFromState } from '@/store/selectors'
import { installSplitPaneHome, splitWithInstalledPaneHome } from './terminal-pane-split-home'

export function splitTerminalPaneWithInheritedCwd(args: {
  worktreeId: string
  tabId: string
  manager: PaneManager
  getManager?: () => PaneManager | null
  paneTransports: Map<number, PtyTransport>
  paneCwdMap: PaneCwdMap
  fallbackCwd: string
  pane: ManagedPane
  direction: 'vertical' | 'horizontal'
  source: TerminalPaneSplitSource
}): void {
  const ptyId = args.paneTransports.get(args.pane.id)?.getPtyId() ?? null
  if (
    splitWebRuntimeTerminal(ptyId, args.direction, args.source, {
      worktreeId: args.worktreeId,
      tabId: args.tabId,
      leafId: args.pane.leafId
    })
  ) {
    return
  }
  const manager = args.getManager ? args.getManager() : args.manager
  if (!manager) {
    return
  }
  const inheritedHome = installSplitPaneHome({
    tabId: args.tabId,
    tabWorktreeId: args.worktreeId,
    sourceLeafId: args.pane.leafId
  })
  const leafHint = inheritedHome ? { leafId: inheritedHome.leafId } : {}
  const cached = args.paneCwdMap.get(args.pane.id)
  if (cached?.confirmed && cached.cwd) {
    const createdPane = splitWithInstalledPaneHome(inheritedHome, () =>
      manager.splitPane(args.pane.id, args.direction, { cwd: cached.cwd, ...leafHint })
    )
    recordCreatedTerminalPaneSplit(createdPane, {
      source: args.source,
      direction: args.direction
    })
    return
  }
  const paneId = args.pane.id
  const cwdPromise =
    cached?.pendingCwd ??
    resolveSplitCwd({
      paneCwdMap: args.paneCwdMap,
      sourcePaneId: paneId,
      sourcePtyId: ptyId,
      fallbackCwd: inheritedHome
        ? (getWorktreeMapFromState(useAppStore.getState()).get(inheritedHome.home.worktreeId)
            ?.path ?? args.fallbackCwd)
        : args.fallbackCwd
    })
  const createdPane = splitWithInstalledPaneHome(inheritedHome, () =>
    manager.splitPane(paneId, args.direction, { cwdPromise, ...leafHint })
  )
  recordCreatedTerminalPaneSplit(createdPane, {
    source: args.source,
    direction: args.direction
  })
}
