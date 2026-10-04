import type { AppState } from '@/store/types'
import {
  resolveRetainedTerminalLeafHome,
  type TerminalPaneHomeState
} from './terminal-pane-home-validity'
import type {
  TerminalLayoutSnapshot,
  TerminalLeafHome
} from '../../../../shared/terminal-tab-types'

type MovedLeafSource = {
  tabId: string
  leafId: string
  worktreeId: string
  layout: TerminalLayoutSnapshot
}

/** The home a pane carries into a tab of `targetWorktreeId`; null when it lands back home. */
export function resolveMovedTerminalLeafHome(
  state: TerminalPaneHomeState &
    Pick<AppState, 'groupsByWorktree' | 'tabsByWorktree' | 'unifiedTabsByWorktree'>,
  source: MovedLeafSource,
  targetWorktreeId: string
): TerminalLeafHome | null {
  // Why: a definitively stale home (deleted or off-host) no longer counts; one still loading is kept.
  const existing = resolveRetainedTerminalLeafHome(
    state,
    source.layout,
    source.worktreeId,
    source.leafId
  )
  const homeWorktreeId = existing?.worktreeId ?? source.worktreeId
  if (homeWorktreeId === targetWorktreeId) {
    return null
  }
  // Why: later moves keep the pre-first-move identity so mobile clients see one stable pane.
  if (existing) {
    return existing
  }
  const unifiedTab = state.unifiedTabsByWorktree[source.worktreeId]?.find(
    (tab) => tab.contentType === 'terminal' && tab.entityId === source.tabId
  )
  const group = unifiedTab
    ? state.groupsByWorktree[source.worktreeId]?.find((entry) => entry.id === unifiedTab.groupId)
    : undefined
  const orderIndex = group && unifiedTab ? group.tabOrder.indexOf(unifiedTab.id) : -1
  const color =
    unifiedTab?.color ??
    state.tabsByWorktree[source.worktreeId]?.find((tab) => tab.id === source.tabId)?.color
  return {
    worktreeId: source.worktreeId,
    sessionTabId: source.tabId,
    sessionLeafId: source.leafId,
    ...(group && orderIndex >= 0
      ? {
          slot: {
            groupId: group.id,
            afterTabId: group.tabOrder[orderIndex - 1] ?? null
          }
        }
      : {}),
    ...(color ? { color } : {}),
    ...(unifiedTab?.isPinned ? { isPinned: true } : {})
  }
}

/** Sets or clears one leaf's home entry. */
export function withTerminalLeafHome(
  layout: TerminalLayoutSnapshot,
  leafId: string,
  home: TerminalLeafHome | null
): TerminalLayoutSnapshot {
  const { homeByLeafId, ...rest } = layout
  const { [leafId]: _previous, ...others } = homeByLeafId ?? {}
  const next = home ? { ...others, [leafId]: home } : others
  return Object.keys(next).length > 0 ? { ...rest, homeByLeafId: next } : rest
}
