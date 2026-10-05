import { useMemo } from 'react'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'
import { getWorktreeIdsWithLiveAgent } from '@/lib/worktree-activity-state'

/** Worktrees the palette treats as awake through a live agent, foreign panes counted for their home. */
export function usePaletteLiveAgentWorktreeIds(
  agentStatusByPaneKey: Record<string, AgentStatusEntry>,
  tabsByWorktree: Record<string, readonly Pick<TerminalTab, 'id'>[]>,
  homedTerminalLayouts: Record<string, TerminalLayoutSnapshot>
): ReadonlySet<string> {
  return useMemo(
    () =>
      getWorktreeIdsWithLiveAgent(
        agentStatusByPaneKey,
        tabsByWorktree,
        // The palette recomputes this snapshot when status inputs change; the
        // clock intentionally reflects the render that performs that snapshot.
        // oxlint-disable-next-line react/purity
        Date.now(),
        homedTerminalLayouts
      ),
    [agentStatusByPaneKey, homedTerminalLayouts, tabsByWorktree]
  )
}
