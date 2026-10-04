import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, type AppState } from '@/store'
import { resolveWorktreeStatus, type WorktreeStatus } from '@/lib/worktree-status'
import { EMPTY_BROWSER_TABS, EMPTY_TABS } from './WorktreeCardHelpers'
import {
  resolveWorktreeStatusPaneInputs,
  selectHostedPaneStatusInputs,
  selectLivePtyIdsForWorktree,
  selectTerminalLayoutRootsForWorktree,
  selectRuntimePaneTitlesForWorktree
} from './worktree-card-status-inputs'
import { selectWorktreeAgentActivitySummary } from './worktree-agent-activity-summary'

type WorktreeActivityStatusState = Pick<
  AppState,
  | 'tabsByWorktree'
  | 'browserTabsByWorktree'
  | 'runtimePaneTitlesByTabId'
  | 'ptyIdsByTabId'
  | 'terminalLayoutsByTabId'
  | 'agentStatusEpoch'
  | 'agentStatusByPaneKey'
  | 'migrationUnsupportedByPtyId'
  | 'retainedAgentsByPaneKey'
  | 'runtimeAgentOrchestrationByPaneKey'
>

export function selectWorktreeActivityStatuses(
  statusInputs: WorktreeActivityStatusState,
  worktreeIds: readonly string[]
): Map<string, WorktreeStatus> {
  const statuses = new Map<string, WorktreeStatus>()
  for (const worktreeId of worktreeIds) {
    const {
      hasPermission,
      hasLiveWorking,
      hasLiveMonitoring,
      hasFailed,
      hasInterrupted,
      hasLiveDone,
      hasRetainedDone,
      hasRetainedFailed,
      agentStatusPaneIdsByTabId,
      stalePaneIdsByTabId
    } = selectWorktreeAgentActivitySummary(statusInputs, worktreeId)
    const hosted = selectHostedPaneStatusInputs(statusInputs, worktreeId)
    const paneInputs = resolveWorktreeStatusPaneInputs(
      {
        tabs: statusInputs.tabsByWorktree[worktreeId] ?? EMPTY_TABS,
        ptyIdsByTabId: selectLivePtyIdsForWorktree(statusInputs, worktreeId),
        runtimePaneTitlesByTabId: selectRuntimePaneTitlesForWorktree(statusInputs, worktreeId),
        terminalLayoutRootsByTabId: selectTerminalLayoutRootsForWorktree(statusInputs, worktreeId)
      },
      worktreeId,
      hosted
    )
    statuses.set(
      worktreeId,
      resolveWorktreeStatus({
        tabs: paneInputs.tabs,
        browserTabs: statusInputs.browserTabsByWorktree[worktreeId] ?? EMPTY_BROWSER_TABS,
        ptyIdsByTabId: paneInputs.ptyIdsByTabId,
        runtimePaneTitlesByTabId: paneInputs.runtimePaneTitlesByTabId,
        agentStatusPaneIdsByTabId,
        stalePaneIdsByTabId,
        terminalLayoutRootsByTabId: paneInputs.terminalLayoutRootsByTabId,
        runtimePaneTitleLeafIdsByTabId: hosted.runtimePaneTitleLeafIdsByTabId,
        hasPermission,
        hasLiveWorking,
        hasLiveMonitoring,
        hasFailed,
        hasInterrupted,
        hasLiveDone,
        hasRetainedDone,
        hasRetainedFailed
      })
    )
  }
  return statuses
}

// Why: return a shallow-stable status map so terminal updates outside the
// visible candidates do not re-render the picker.
export function useWorktreeActivityStatuses(
  worktreeIds: readonly string[]
): Map<string, WorktreeStatus> {
  const selectStatuses = useCallback(
    (state: WorktreeActivityStatusState) => selectWorktreeActivityStatuses(state, worktreeIds),
    [worktreeIds]
  )
  return useAppStore(useShallow(selectStatuses))
}
