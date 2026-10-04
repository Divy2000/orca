import type { AppState } from '@/store/types'
import { normalizeTerminalLeafHomes } from '../../../../shared/terminal-pane-home'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneSplitDirection
} from '../../../../shared/terminal-tab-types'
import {
  detachLastTerminalLayoutLeaf,
  detachTerminalLayoutLeaf
} from './terminal-layout-leaf-detach'
import {
  insertTerminalLayoutLeaf,
  type TerminalLayoutLeafPlacement
} from './terminal-layout-leaf-insert'
import { reconcileForeignOnlyTerminalTab } from './terminal-pane-foreign-only-reconciliation'
import {
  canMoveTerminalPane,
  type TerminalPaneMoveRejection
} from './terminal-pane-move-eligibility'
import {
  resolveTerminalPaneMoveSurface,
  type TerminalPaneMoveSurface
} from './terminal-pane-move-surface'
import { resolveMovedTerminalLeafHome, withTerminalLeafHome } from './terminal-pane-moved-leaf-home'
import { dispatchTerminalPaneSplitRequest } from './terminal-pane-split-request-routing'

export { canMoveTerminalPane } from './terminal-pane-move-eligibility'
export type { TerminalPaneMoveRejection } from './terminal-pane-move-eligibility'

export type TerminalPaneDropZone = 'left' | 'right' | 'top' | 'bottom'

export type TerminalPaneMoveResult =
  | { ok: true; fallbackTabId?: string }
  | { ok: false; reason: TerminalPaneMoveRejection }

const SPLIT_BY_ZONE: Record<
  TerminalPaneDropZone,
  {
    direction: TerminalPaneSplitDirection
    placement: TerminalLayoutLeafPlacement
  }
> = {
  left: { direction: 'vertical', placement: 'before' },
  right: { direction: 'vertical', placement: 'after' },
  top: { direction: 'horizontal', placement: 'before' },
  bottom: { direction: 'horizontal', placement: 'after' }
}

function withLeafPty(
  layout: TerminalLayoutSnapshot,
  leafId: string,
  ptyId: string
): TerminalLayoutSnapshot {
  return {
    ...layout,
    ptyIdsByLeafId: { ...layout.ptyIdsByLeafId, [leafId]: ptyId }
  }
}

/** Mounted target panes adopt the PTY through their split handler, which writes nothing on failure. */
function adoptInMountedTarget(
  target: TerminalPaneMoveSurface,
  leafId: string,
  ptyId: string,
  zone: TerminalPaneDropZone
): boolean {
  if (!target.mountedManager) {
    return true
  }
  dispatchTerminalPaneSplitRequest({
    tabId: target.tabId,
    worktreeId: target.worktreeId,
    paneRuntimeId: target.paneId,
    sourceLeafId: target.leafId,
    newLeafId: leafId,
    ptyId,
    ...SPLIT_BY_ZONE[zone],
    movedLeaf: true
  })
  return target.mountedManager.getNumericIdForLeaf(leafId) !== null
}

/** Last resort when a mounted target could not adopt the pane: keep the PTY in a new tab there. */
function landInNewTargetTab(
  getState: () => AppState,
  target: TerminalPaneMoveSurface,
  movedLayout: TerminalLayoutSnapshot,
  leafId: string,
  ptyId: string
): string {
  const store = getState()
  store.setTabLayout(target.tabId, target.layout)
  const tab = store.createTab(target.worktreeId, undefined, undefined, {
    initialPtyId: ptyId,
    initialLeafId: leafId,
    activate: false,
    recordInteraction: false
  })
  getState().setTabLayout(tab.id, normalizeTerminalLeafHomes(movedLayout, target.worktreeId))
  return tab.id
}

/**
 * Moves a live pane into another tab's split next to `targetPaneKey`, keeping its PTY. The pane
 * records its home workspace while it sits in a tab of another one; an emptied source tab closes.
 */
export function moveTerminalPaneIntoSplit(
  getState: () => AppState,
  sourcePaneKey: string,
  targetPaneKey: string,
  zone: TerminalPaneDropZone
): TerminalPaneMoveResult {
  const check = canMoveTerminalPane(getState(), sourcePaneKey, targetPaneKey)
  if (!check.ok) {
    return check
  }
  check.source.persistLayoutSnapshot()
  check.target.persistLayoutSnapshot()
  const state = getState()
  const source = resolveTerminalPaneMoveSurface(state, sourcePaneKey)
  const target = resolveTerminalPaneMoveSurface(state, targetPaneKey)
  const ptyId = source?.ptyId
  if (!source || !target || !ptyId) {
    return { ok: false, reason: 'pane-missing' }
  }
  const leafId = source.leafId
  const detachesLastPane = source.leafIds.length === 1
  const detached = detachesLastPane
    ? detachLastTerminalLayoutLeaf(source.layout, leafId)
    : detachTerminalLayoutLeaf(source.layout, leafId)
  const movedLayout = detached
    ? withTerminalLeafHome(
        withLeafPty(detached.detachedLayout, leafId, ptyId),
        leafId,
        resolveMovedTerminalLeafHome(state, source, target.worktreeId)
      )
    : null
  const joinedLayout = movedLayout
    ? insertTerminalLayoutLeaf({
        targetLayout: target.layout,
        targetLeafId: target.leafId,
        insertedLayout: movedLayout,
        ...SPLIT_BY_ZONE[zone]
      })
    : null
  if (!detached || !movedLayout || !joinedLayout) {
    return { ok: false, reason: 'pane-missing' }
  }
  // Why: the renderer pane goes first and only detaches its listeners; the PTY keeps running.
  if (!detachesLastPane && !source.manager.detachPaneForExternalMove(source.paneId)) {
    return { ok: false, reason: 'pane-missing' }
  }
  if (!detachesLastPane) {
    getState().setTabLayout(source.tabId, detached.sourceLayout)
  }
  // Why before the split: the mounted target's layout persistence carries the leaf's records and home.
  getState().setTabLayout(target.tabId, joinedLayout)
  const fallbackTabId = adoptInMountedTarget(target, leafId, ptyId, zone)
    ? undefined
    : landInNewTargetTab(getState, target, movedLayout, leafId, ptyId)
  const ownerTabId = fallbackTabId ?? target.tabId
  getState().syncPaneDetachPtyOwnership({
    detachedLeafId: leafId,
    detachedPtyId: ptyId,
    sourceLayout: detached.sourceLayout,
    sourceTabId: source.tabId,
    targetTabId: ownerTabId,
    ...(fallbackTabId
      ? {}
      : {
          targetLayout: getState().terminalLayoutsByTabId[target.tabId] ?? joinedLayout
        })
  })
  if (detachesLastPane) {
    // Why 'cleanup': the target owns the PTY, so retirement treats it as shared; 'pty-exit' would leave main's membership behind.
    getState().closeTab(source.tabId, {
      reason: 'cleanup',
      captureRecentlyClosed: false
    })
  } else {
    reconcileForeignOnlyTerminalTab(getState, source.tabId)
  }
  return fallbackTabId ? { ok: true, fallbackTabId } : { ok: true }
}
