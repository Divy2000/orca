import type { AppState } from '@/store/types'
import { requestBackgroundTerminalWorktreeMount } from '../terminal/background-terminal-worktree-mount'
import { resolveTerminalLeafHome } from '../../../../shared/terminal-pane-home'
import type { TerminalLeafHome } from '../../../../shared/terminal-tab-types'
import { resolveTerminalPaneMoveSurface } from './terminal-pane-move-surface'
import { detachTerminalPaneToTab } from './terminal-pane-tab-detach'
import { resolveTerminalPaneHomeStatus } from './terminal-pane-home-validity'
import { withTerminalLeafHome } from './terminal-pane-moved-leaf-home'

export type SendTerminalPaneHomeResult =
  | { ok: true; tabId: string }
  | {
      ok: false
      reason:
        | 'pane-missing'
        | 'not-foreign'
        | 'home-unknown'
        | 'home-unavailable'
        | 'pane-not-ready'
    }

/** The home tab slot recorded on first move, while that group still exists. */
function resolveHomeSlot(
  state: Pick<AppState, 'groupsByWorktree'>,
  home: TerminalLeafHome
): { targetGroupId?: string; targetIndex?: number } {
  const group = home.slot
    ? state.groupsByWorktree[home.worktreeId]?.find((entry) => entry.id === home.slot?.groupId)
    : undefined
  if (!group || !home.slot) {
    return {}
  }
  const afterIndex = home.slot.afterTabId ? group.tabOrder.indexOf(home.slot.afterTabId) : -1
  return {
    targetGroupId: group.id,
    ...(home.slot.afterTabId === null || afterIndex >= 0 ? { targetIndex: afterIndex + 1 } : {})
  }
}

/** Color and pin the source tab had when the pane first left home. */
function restoreHomeTabAppearance(
  getState: () => AppState,
  tabId: string,
  home: TerminalLeafHome
): void {
  if (home.color) {
    getState().setTabColor(tabId, home.color)
  }
  if (home.isPinned) {
    getState().pinTab(tabId)
  }
}

/**
 * Moves a pane hosted in another workspace's tab back to a new, inactive tab of its home workspace,
 * keeping its live PTY. A host tab left empty closes. `backgroundMount: false` skips mounting the
 * new tab, for callers about to stop the home workspace anyway.
 */
export function sendTerminalPaneHome(
  getState: () => AppState,
  paneKey: string,
  opts: { backgroundMount?: boolean } = {}
): SendTerminalPaneHomeResult {
  const state = getState()
  const surface = resolveTerminalPaneMoveSurface(state, paneKey)
  if (!surface) {
    return { ok: false, reason: 'pane-missing' }
  }
  const home = resolveTerminalLeafHome(surface.layout, surface.worktreeId, surface.leafId)
  if (!home) {
    return { ok: false, reason: 'not-foreign' }
  }
  const homeStatus = resolveTerminalPaneHomeStatus(state, surface.worktreeId, home.worktreeId)
  if (homeStatus === 'unknown') {
    return { ok: false, reason: 'home-unknown' }
  }
  if (homeStatus === 'unreachable') {
    // Why: a deleted or off-host home has nowhere to receive the PTY, so the pane stays put as
    // native. Persist first so a live PTY known only to the mounted pane keeps its binding.
    surface.persistLayoutSnapshot()
    const latest = getState().terminalLayoutsByTabId[surface.tabId] ?? surface.layout
    getState().setTabLayout(surface.tabId, withTerminalLeafHome(latest, surface.leafId, null))
    return { ok: false, reason: 'home-unavailable' }
  }
  const detached = detachTerminalPaneToTab({
    fallbackPtyId: surface.ptyId,
    getStore: getState,
    manager: surface.manager,
    persistLayoutSnapshot: surface.persistLayoutSnapshot,
    sourcePaneId: surface.paneId,
    ...(surface.paneCwd ? { sourcePaneCwd: surface.paneCwd } : {}),
    sourceTabId: surface.tabId,
    ...resolveHomeSlot(state, home),
    worktreeId: surface.worktreeId,
    targetWorktreeId: home.worktreeId,
    activate: false,
    allowLastPane: true
  })
  if (!detached) {
    return { ok: false, reason: 'pane-not-ready' }
  }
  restoreHomeTabAppearance(getState, detached.tab.id, home)
  // Why: a pane that was live on screen keeps rendering (and reporting agent state) in its home.
  if (surface.mountedManager && opts.backgroundMount !== false) {
    requestBackgroundTerminalWorktreeMount({
      worktreeId: home.worktreeId,
      tabIds: [detached.tab.id]
    })
  }
  return { ok: true, tabId: detached.tab.id }
}
