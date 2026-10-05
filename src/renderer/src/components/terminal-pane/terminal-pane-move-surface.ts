import type { AppState } from '@/store/types'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { findRegisteredTerminalTab } from '@/runtime/sync-runtime-graph/graph-state'
import { locateTerminalTab } from '@/store/terminals/terminal-tab-location'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import type { PaneCwdEntry } from './resolve-split-cwd'
import { collectLeafIdsInOrder } from './terminal-layout-leaf-ids'

/** The pane-manager surface a pane move drives: a mounted PaneManager or the stored layout. */
export type TerminalPaneMoveManager = {
  getPanes: () => readonly { id: number }[]
  getLeafId: (paneId: number) => string | null
  detachPaneForExternalMove: (paneId: number) => boolean
}

export type TerminalPaneMoveSurface = {
  tabId: string
  leafId: string
  worktreeId: string
  layout: TerminalLayoutSnapshot
  leafIds: readonly string[]
  /** Null when the tab has no mounted TerminalPane; the move then edits only the store. */
  mountedManager: PaneManager | null
  manager: TerminalPaneMoveManager
  paneId: number
  ptyId: string | null
  paneCwd: PaneCwdEntry | undefined
  persistLayoutSnapshot: () => void
}

export type TerminalPaneMoveSurfaceState = Pick<
  AppState,
  'tabsByWorktree' | 'terminalLayoutsByTabId'
>

function storedLayoutManager(leafIds: readonly string[]): TerminalPaneMoveManager {
  return {
    getPanes: () => leafIds.map((_, index) => ({ id: index })),
    getLeafId: (paneId) => leafIds[paneId] ?? null,
    // Why: nothing is mounted, so the stored layout edit is the whole detach.
    detachPaneForExternalMove: () => leafIds.length > 1
  }
}

/** Resolves a pane key to the tab, layout and pane manager a move or send-home operates on. */
export function resolveTerminalPaneMoveSurface(
  state: TerminalPaneMoveSurfaceState,
  paneKey: string
): TerminalPaneMoveSurface | null {
  const parsed = parsePaneKey(paneKey)
  const located = parsed ? locateTerminalTab(state.tabsByWorktree, parsed.tabId) : null
  const layout = parsed ? state.terminalLayoutsByTabId[parsed.tabId] : undefined
  if (!parsed || !located || !layout) {
    return null
  }
  const leafIds = collectLeafIdsInOrder(layout.root)
  if (!leafIds.includes(parsed.leafId)) {
    return null
  }
  const storedPtyId = layout.ptyIdsByLeafId?.[parsed.leafId] ?? null
  const registered = findRegisteredTerminalTab(parsed.tabId, located.worktreeId)?.tab
  const mountedManager = registered?.getManager() ?? null
  const base = {
    tabId: parsed.tabId,
    leafId: parsed.leafId,
    worktreeId: located.worktreeId,
    layout,
    leafIds
  }
  if (!registered || !mountedManager) {
    return {
      ...base,
      mountedManager: null,
      manager: storedLayoutManager(leafIds),
      paneId: leafIds.indexOf(parsed.leafId),
      ptyId: storedPtyId,
      paneCwd: undefined,
      persistLayoutSnapshot: () => {}
    }
  }
  const paneId = mountedManager.getNumericIdForLeaf(parsed.leafId)
  if (paneId === null) {
    return null
  }
  return {
    ...base,
    mountedManager,
    manager: mountedManager,
    paneId,
    ptyId: storedPtyId ?? registered.getPtyIdForPane(paneId),
    paneCwd: registered.getPaneCwd?.(paneId),
    persistLayoutSnapshot: registered.persistLayoutSnapshot ?? (() => {})
  }
}
