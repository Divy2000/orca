import { useAppStore } from '@/store'
import { mintStablePaneId } from '@/lib/pane-manager/mint-stable-pane-id'
import { resolveTerminalLeafHome } from '../../../../shared/terminal-pane-home'
import type { TerminalLeafHome } from '../../../../shared/terminal-tab-types'

/**
 * A split of a pane hosted for another workspace belongs to that home too. Writes the new
 * leaf's home before the split so the pane's creation already reports to it. `homeWorktreeId`
 * is a caller's explicit home; otherwise the source leaf's own home is inherited.
 */
export function installSplitPaneHome(args: {
  tabId: string
  tabWorktreeId: string
  sourceLeafId: string | null | undefined
  newLeafId?: string
  homeWorktreeId?: string
}): InstalledSplitPaneHome | null {
  const state = useAppStore.getState()
  const layout = state.terminalLayoutsByTabId[args.tabId]
  const sourceHome = args.sourceLeafId
    ? resolveTerminalLeafHome(layout, args.tabWorktreeId, args.sourceLeafId)
    : null
  const homeWorktreeId = args.homeWorktreeId ?? sourceHome?.worktreeId
  if (!layout || !homeWorktreeId || homeWorktreeId === args.tabWorktreeId) {
    return null
  }
  const leafId = args.newLeafId ?? mintStablePaneId()
  const home: TerminalLeafHome =
    sourceHome?.worktreeId === homeWorktreeId
      ? { ...sourceHome, sessionLeafId: leafId }
      : { worktreeId: homeWorktreeId, sessionTabId: args.tabId, sessionLeafId: leafId }
  state.setTabLayout(args.tabId, {
    ...layout,
    homeByLeafId: { ...layout.homeByLeafId, [leafId]: home }
  })
  return { leafId, home, rollback: () => removeSplitPaneHome(args.tabId, leafId, home) }
}

export type InstalledSplitPaneHome = {
  leafId: string
  home: TerminalLeafHome
  /** Removes the pre-written home when the split never created its pane. */
  rollback: () => void
}

function removeSplitPaneHome(tabId: string, leafId: string, home: TerminalLeafHome): void {
  const state = useAppStore.getState()
  const layout = state.terminalLayoutsByTabId[tabId]
  if (layout?.homeByLeafId?.[leafId] !== home) {
    return
  }
  const { [leafId]: _removed, ...remaining } = layout.homeByLeafId
  const { homeByLeafId: _homes, ...rest } = layout
  state.setTabLayout(
    tabId,
    Object.keys(remaining).length > 0 ? { ...rest, homeByLeafId: remaining } : rest
  )
}

/** Runs a split for a pre-written home, rolling the home back if no pane was created. */
export function splitWithInstalledPaneHome<T>(
  installed: InstalledSplitPaneHome | null,
  split: () => T | null | undefined
): T | null | undefined {
  let created: T | null | undefined
  try {
    created = split()
  } catch (error) {
    installed?.rollback()
    throw error
  }
  if (!created) {
    installed?.rollback()
  }
  return created
}
