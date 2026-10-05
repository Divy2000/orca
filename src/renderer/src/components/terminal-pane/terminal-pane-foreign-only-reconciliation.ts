import type { AppState } from '@/store/types'
import { locateTerminalTab } from '@/store/terminals/terminal-tab-location'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { resolveTerminalLeafHome } from '../../../../shared/terminal-pane-home'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { collectLeafIdsInOrder } from './terminal-layout-leaf-ids'
import { sendTerminalPaneHome } from './terminal-pane-send-home'

function soleForeignLeafId(
  layout: TerminalLayoutSnapshot | undefined,
  hostWorktreeId: string
): string | null {
  const leafIds = collectLeafIdsInOrder(layout?.root)
  const [leafId] = leafIds
  return leafIds.length === 1 && leafId && resolveTerminalLeafHome(layout, hostWorktreeId, leafId)
    ? leafId
    : null
}

/** A host tab whose only pane belongs elsewhere sends that pane home (and closes). */
export function reconcileForeignOnlyTerminalTab(getState: () => AppState, tabId: string): boolean {
  const state = getState()
  const located = locateTerminalTab(state.tabsByWorktree, tabId)
  const leafId = located
    ? soleForeignLeafId(state.terminalLayoutsByTabId[tabId], located.worktreeId)
    : null
  return leafId ? sendTerminalPaneHome(getState, makePaneKey(tabId, leafId)).ok : false
}

type ReconcilerStore = {
  getState: () => AppState
  subscribe: (listener: (state: AppState, previous: AppState) => void) => () => void
}

function countLeaves(layout: TerminalLayoutSnapshot | undefined): number {
  return collectLeafIdsInOrder(layout?.root).length
}

/**
 * Sends a pane home when any close shrinks a mixed split to just that foreign pane. Only shrinks
 * count: a tab created or restored holding one foreign pane is left as the user arranged it.
 */
export function installForeignOnlyTerminalTabReconciler(store: ReconcilerStore): () => void {
  return store.subscribe((state, previous) => {
    if (state.terminalLayoutsByTabId === previous.terminalLayoutsByTabId) {
      return
    }
    const shrunk = Object.entries(state.terminalLayoutsByTabId)
      .filter(([tabId, layout]) => {
        const before = previous.terminalLayoutsByTabId[tabId]
        return layout !== before && countLeaves(layout) === 1 && countLeaves(before) > 1
      })
      .map(([tabId]) => tabId)
    if (shrunk.length === 0) {
      return
    }
    // Why deferred: a close or move is still mid-way through its own store writes.
    queueMicrotask(() => {
      for (const tabId of shrunk) {
        reconcileForeignOnlyTerminalTab(store.getState, tabId)
      }
    })
  })
}
