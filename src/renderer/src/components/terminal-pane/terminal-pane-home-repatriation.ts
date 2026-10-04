import type { AppState } from '@/store/types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { resolveTerminalLeafHomeWorktreeId } from '../../../../shared/terminal-pane-home'
import { collectLeafIdsInOrder } from './terminal-layout-leaf-ids'
import { sendTerminalPaneHome } from './terminal-pane-send-home'

type LeafPlacement = {
  paneKey: string
  hostWorktreeId: string
  homeWorktreeId: string
}

function collectForeignLeafPlacements(state: AppState): LeafPlacement[] {
  const placements: LeafPlacement[] = []
  for (const [hostWorktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    for (const tab of tabs) {
      const layout = state.terminalLayoutsByTabId[tab.id]
      for (const leafId of Object.keys(layout?.homeByLeafId ?? {})) {
        const homeWorktreeId = resolveTerminalLeafHomeWorktreeId(layout, hostWorktreeId, leafId)
        if (
          homeWorktreeId !== hostWorktreeId &&
          collectLeafIdsInOrder(layout?.root).includes(leafId)
        ) {
          placements.push({
            paneKey: makePaneKey(tab.id, leafId),
            hostWorktreeId,
            homeWorktreeId
          })
        }
      }
    }
  }
  return placements
}

/**
 * Untangles a workspace's cross-workspace panes before it sleeps or is removed: panes it hosts go
 * home alive, and its own panes hosted elsewhere come back so they sleep or stop with it.
 */
export function repatriateTerminalPaneHomesForShutdown(
  getState: () => AppState,
  worktreeId: string
): void {
  for (const placement of collectForeignLeafPlacements(getState())) {
    if (placement.hostWorktreeId === worktreeId) {
      sendTerminalPaneHome(getState, placement.paneKey)
    } else if (placement.homeWorktreeId === worktreeId) {
      // Why no mount: this workspace is about to stop the pane it just reclaimed.
      sendTerminalPaneHome(getState, placement.paneKey, {
        backgroundMount: false
      })
    }
  }
}
