import type { AppState } from '@/store/types'
import type { PaneExternalDropTarget } from '@/lib/pane-manager/pane-manager'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import {
  isTerminalPaneHomeDropTarget,
  resolveTerminalPaneHomeDropTarget
} from './terminal-pane-home-drop-target'
import { requestTerminalPaneMoveIntoSplit } from './terminal-pane-move-action'
import { requestTerminalPaneSendHome } from './terminal-pane-send-home-action'
import {
  isTerminalPaneSplitDropTarget,
  resolveTerminalPaneSplitDropTarget
} from './terminal-pane-split-drop-target'
import { resolveTerminalTabStripDropTarget } from './terminal-tab-strip-drop-target'
import { resolveTerminalPaneHomeLabels } from './use-terminal-pane-home-labels'

/** Whether the leaf offers "Back to {workspace}", which is what a sidebar drop does. */
function canSendLeafHome(
  state: AppState,
  tabId: string,
  worktreeId: string,
  leafId: string
): boolean {
  const homeByLeafId = state.terminalLayoutsByTabId[tabId]?.homeByLeafId
  return resolveTerminalPaneHomeLabels(state, homeByLeafId, worktreeId)[leafId] !== undefined
}

/** Where a pane dragged out of its tab lands: its tab strip, another tab's split, or home. */
export function resolveTerminalPaneExternalDropTarget(args: {
  clientX: number
  clientY: number
  tabId: string
  worktreeId: string
  sourceLeafId: string | null
  state: AppState
}): PaneExternalDropTarget | null {
  const point = { clientX: args.clientX, clientY: args.clientY }
  const tabStrip = resolveTerminalTabStripDropTarget({
    ...point,
    groupsByWorktree: args.state.groupsByWorktree,
    worktreeId: args.worktreeId
  })
  if (tabStrip) {
    return tabStrip
  }
  const split = resolveTerminalPaneSplitDropTarget({ ...point, excludeTabId: args.tabId })
  if (split) {
    return split
  }
  if (
    !args.sourceLeafId ||
    !canSendLeafHome(args.state, args.tabId, args.worktreeId, args.sourceLeafId)
  ) {
    return null
  }
  return resolveTerminalPaneHomeDropTarget(point)
}

/** Commits a drop on another tab's pane or on the sidebar; tab-strip drops are handled elsewhere. */
export function commitTerminalPaneCrossTabDrop(args: {
  tabId: string
  leafId: string | null
  target: PaneExternalDropTarget
}): boolean {
  if (!args.leafId) {
    return false
  }
  if (isTerminalPaneSplitDropTarget(args.target)) {
    return requestTerminalPaneMoveIntoSplit(
      makePaneKey(args.tabId, args.leafId),
      args.target.paneKey,
      args.target.zone
    )
  }
  if (isTerminalPaneHomeDropTarget(args.target)) {
    requestTerminalPaneSendHome(args.tabId, args.leafId)
    return true
  }
  return false
}
