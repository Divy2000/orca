import type { AppState } from '@/store/types'
import { positionDropOverlayRect } from '@/lib/pane-manager/pane-drop-zone'
import {
  clearActiveTerminalSessionDrag,
  type TerminalSessionDragPayload
} from '@/lib/terminal-session-drag-data'
import { acquireWebviewsDragPassthrough } from '../browser-pane/host-guest/webview-drag-passthrough'
import { isTerminalLeafId, makePaneKey, parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  buildTerminalPaneHomeIndex,
  type TerminalPaneHomeIndex
} from '@/lib/terminal-pane-home-index'
import { collectLeafIdsInOrder } from './terminal-layout-leaf-ids'
import { getWorktreeVisitTimestamp } from '@/lib/worktree-visit-recency'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { requestTerminalPaneMoveIntoSplit } from './terminal-pane-move-action'
import {
  resolveTerminalPaneSplitDropTarget,
  type TerminalPaneSplitDropTarget
} from './terminal-pane-split-drop-target'

let dropOverlay: HTMLElement | null = null
let releasePointerDragPassthrough: (() => void) | null = null

type TerminalSessionSourceState = Pick<
  AppState,
  | 'activeTabIdByWorktree'
  | 'tabsByWorktree'
  | 'terminalLayoutsByTabId'
  | 'lastVisitedAtByWorktreeId'
> &
  Parameters<typeof getExecutionHostIdForWorktree>[0]

function toPaneKey(tabId: string, leafId: string | undefined): string | null {
  return leafId && isTerminalLeafId(leafId) && !tabId.includes(':')
    ? makePaneKey(tabId, leafId)
    : null
}

/** The tab's active pane, falling back to its first pane. */
export function resolveTerminalTabActivePaneKey(
  state: Pick<AppState, 'terminalLayoutsByTabId'>,
  tabId: string
): string | null {
  const layout = state.terminalLayoutsByTabId[tabId]
  const leafIds = collectLeafIdsInOrder(layout?.root ?? null)
  const leafId =
    layout?.activeLeafId && leafIds.includes(layout.activeLeafId) ? layout.activeLeafId : leafIds[0]
  return toPaneKey(tabId, leafId)
}

/** The workspace's own pane in its active terminal tab: the active one, else the first. */
function resolveActiveNativePaneKey(
  state: TerminalSessionSourceState,
  homeIndex: TerminalPaneHomeIndex,
  worktreeId: string
): string | null {
  const tabId = state.activeTabIdByWorktree[worktreeId]
  if (!tabId || !(state.tabsByWorktree[worktreeId] ?? []).some((tab) => tab.id === tabId)) {
    return null
  }
  const layout = state.terminalLayoutsByTabId[tabId]
  const nativeLeafIds = collectLeafIdsInOrder(layout?.root ?? null).filter(
    (leafId) => !homeIndex.homeWorktreeIdByPaneKey.has(`${tabId}:${leafId}`)
  )
  const leafId =
    layout?.activeLeafId && nativeLeafIds.includes(layout.activeLeafId)
      ? layout.activeLeafId
      : nativeLeafIds[0]
  return toPaneKey(tabId, leafId)
}

function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return (a[index] ?? 0) - (b[index] ?? 0)
    }
  }
  return 0
}

/** Of the workspace's panes hosted in other workspaces' splits, the most recently active one. */
function resolveRecentHostedPaneKey(
  state: TerminalSessionSourceState,
  homeIndex: TerminalPaneHomeIndex,
  worktreeId: string
): string | null {
  let best: { paneKey: string; rank: readonly number[] } | null = null
  for (const [paneKey, homeWorktreeId] of homeIndex.homeWorktreeIdByPaneKey) {
    const parsed = parsePaneKey(paneKey)
    const hostWorktreeId = parsed ? homeIndex.hostWorktreeIdByTabId.get(parsed.tabId) : undefined
    if (homeWorktreeId !== worktreeId || !parsed || !hostWorktreeId) {
      continue
    }
    // Why this order: host visit time, then the host's active tab, then that tab's focused leaf.
    const rank = [
      getWorktreeVisitTimestamp(state.lastVisitedAtByWorktreeId, {
        id: hostWorktreeId,
        hostId: getExecutionHostIdForWorktree(state, hostWorktreeId)
      }) ?? 0,
      state.activeTabIdByWorktree[hostWorktreeId] === parsed.tabId ? 1 : 0,
      state.terminalLayoutsByTabId[parsed.tabId]?.activeLeafId === parsed.leafId ? 1 : 0
    ]
    if (!best || compareRanks(rank, best.rank) > 0) {
      best = { paneKey, rank }
    }
  }
  return best?.paneKey ?? null
}

/**
 * The terminal a dragged workspace stands for: its active native terminal, else its most recently
 * active pane hosted in another workspace's split. Null when it has no live terminal.
 */
export function resolveWorkspaceTerminalSessionDrag(
  state: TerminalSessionSourceState,
  worktreeId: string
): TerminalSessionDragPayload | null {
  const homeIndex = buildTerminalPaneHomeIndex(state.tabsByWorktree, state.terminalLayoutsByTabId)
  const paneKey =
    resolveActiveNativePaneKey(state, homeIndex, worktreeId) ??
    resolveRecentHostedPaneKey(state, homeIndex, worktreeId)
  return paneKey ? { paneKey, worktreeId } : null
}

export function resolveTerminalSessionDropTarget(
  clientX: number,
  clientY: number,
  payload: TerminalSessionDragPayload
): TerminalPaneSplitDropTarget | null {
  const sourceTabId = parsePaneKey(payload.paneKey)?.tabId ?? null
  return resolveTerminalPaneSplitDropTarget({ clientX, clientY, excludeTabId: sourceTabId })
}

export function commitTerminalSessionDrop(
  payload: TerminalSessionDragPayload,
  target: TerminalPaneSplitDropTarget
): boolean {
  return requestTerminalPaneMoveIntoSplit(payload.paneKey, target.paneKey, target.zone)
}

/** Shows the pane-edge overlay for `target`, or hides it for null. */
export function showTerminalSessionDropOverlay(target: TerminalPaneSplitDropTarget | null): void {
  if (!target) {
    if (dropOverlay) {
      dropOverlay.style.display = 'none'
    }
    return
  }
  if (!dropOverlay) {
    dropOverlay = document.createElement('div')
    dropOverlay.className = 'pane-drop-overlay'
    document.body.appendChild(dropOverlay)
  }
  positionDropOverlayRect(dropOverlay, target.rect, target.overlayKind)
}

export function removeTerminalSessionDropOverlay(): void {
  dropOverlay?.remove()
  dropOverlay = null
}

/** One frame of a renderer-owned pointer drag (sidebar workspace cards) over terminal panes. */
export function updateTerminalSessionPointerDrop(args: {
  clientX: number
  clientY: number
  payload: TerminalSessionDragPayload | null
}): TerminalPaneSplitDropTarget | null {
  // Why: pointer drags emit no HTML dragstart, so webviews would otherwise swallow the pointer.
  releasePointerDragPassthrough ??= acquireWebviewsDragPassthrough()
  const target = args.payload
    ? resolveTerminalSessionDropTarget(args.clientX, args.clientY, args.payload)
    : null
  showTerminalSessionDropOverlay(target)
  return target
}

export function endTerminalSessionPointerDrop(): void {
  releasePointerDragPassthrough?.()
  releasePointerDragPassthrough = null
  removeTerminalSessionDropOverlay()
}

/** Ends an HTML drag from a sidebar row, dropped or not. */
export function endTerminalSessionDrag(): void {
  clearActiveTerminalSessionDrag()
  removeTerminalSessionDropOverlay()
}
