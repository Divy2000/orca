import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'
import {
  isFreshNonDoneAgentStatus,
  type AgentStatusEntry
} from '../../../shared/agent-status-types'
import { resolveAgentStatusWorktreeId } from './agent-status-worktree-attribution'
import { buildTerminalPaneHomeIndex } from './terminal-pane-home-index'
import {
  collectHomedPaneStatusInputs,
  omitForeignPanePtyIds
} from './terminal-host-native-pane-inputs'

type TerminalLikeTab = Pick<TerminalTab, 'id'>
type BrowserLikeTab = { id: string }

type TabsByWorktree = Record<string, readonly TerminalLikeTab[]>
type PtyIdsByTabId = Record<string, string[]>
type BrowserTabsByWorktree = Record<string, readonly BrowserLikeTab[]>
type TerminalLayoutsByTabId = Record<string, TerminalLayoutSnapshot>
export type LiveAgentWorktreeStatus = 'working' | 'monitoring' | 'permission'

const EMPTY_WORKTREE_IDS: ReadonlySet<string> = new Set()

/**
 * Worktree ids that currently have a live agent session, derived from the
 * live `agentStatusByPaneKey` map.
 *
 * Why only fresh in-progress rows: disconnected SSH and completed headless
 * agents can retain status entries without an open session.
 */
export function getWorktreeIdsWithLiveAgent(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | null | undefined,
  tabsByWorktree: TabsByWorktree | null | undefined,
  now: number,
  terminalLayoutsByTabId?: TerminalLayoutsByTabId | null
): Set<string> {
  return new Set(
    getLiveAgentStatusByWorktreeId(
      agentStatusByPaneKey,
      tabsByWorktree,
      now,
      terminalLayoutsByTabId
    ).keys()
  )
}

export function getLiveAgentStatusByWorktreeId(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | null | undefined,
  tabsByWorktree: TabsByWorktree | null | undefined,
  now: number,
  terminalLayoutsByTabId?: TerminalLayoutsByTabId | null
): Map<string, LiveAgentWorktreeStatus> {
  const entries = Object.values(agentStatusByPaneKey ?? {}).filter((entry) =>
    isFreshNonDoneAgentStatus(entry, now)
  )
  if (entries.length === 0) {
    return new Map()
  }
  const paneHomeIndex = buildTerminalPaneHomeIndex(tabsByWorktree, terminalLayoutsByTabId)
  const result = new Map<string, LiveAgentWorktreeStatus>()
  for (const entry of entries) {
    const worktreeId = resolveAgentStatusWorktreeId(
      entry,
      paneHomeIndex.hostWorktreeIdByTabId,
      undefined,
      paneHomeIndex.homeWorktreeIdByPaneKey
    )
    if (worktreeId) {
      const status =
        entry.state === 'working'
          ? entry.workingMode === 'monitoring'
            ? 'monitoring'
            : 'working'
          : 'permission'
      const current = result.get(worktreeId)
      if (
        status === 'permission' ||
        current === undefined ||
        (status === 'working' && current === 'monitoring')
      ) {
        result.set(worktreeId, status)
      }
    }
  }
  return result
}

// Why: a foreign pane's PTY sits in its host tab's list but keeps its home workspace awake, not the host.
function worktreeHasLiveTerminal(
  worktreeId: string,
  tabsByWorktree: TabsByWorktree | null | undefined,
  ptyIdsByTabId: PtyIdsByTabId,
  terminalLayoutsByTabId: TerminalLayoutsByTabId | null | undefined
): boolean {
  const index = buildTerminalPaneHomeIndex(tabsByWorktree, terminalLayoutsByTabId)
  const nativePtyIdsByTabId = omitForeignPanePtyIds(
    ptyIdsByTabId,
    terminalLayoutsByTabId,
    index.foreignLeafIdsByTabId
  )
  if (
    (tabsByWorktree?.[worktreeId] ?? []).some((tab) => tabHasLivePty(nativePtyIdsByTabId, tab.id))
  ) {
    return true
  }
  const homed = collectHomedPaneStatusInputs(
    index,
    worktreeId,
    terminalLayoutsByTabId,
    ptyIdsByTabId,
    {},
    {}
  )
  return Object.keys(homed?.ptyIdsByTabId ?? {}).length > 0
}

function hasActiveWorkspaceActivity(
  worktreeId: string,
  tabsByWorktree: TabsByWorktree | null | undefined,
  ptyIdsByTabId: PtyIdsByTabId | null | undefined,
  browserTabsByWorktree: BrowserTabsByWorktree | null | undefined,
  worktreeIdsWithLiveAgent: ReadonlySet<string>,
  worktreeIdsWithStructuredChat: ReadonlySet<string> = EMPTY_WORKTREE_IDS,
  terminalLayoutsByTabId?: TerminalLayoutsByTabId | null
): boolean {
  const hasLiveTerminal =
    ptyIdsByTabId != null &&
    worktreeHasLiveTerminal(worktreeId, tabsByWorktree, ptyIdsByTabId, terminalLayoutsByTabId)
  const hasBrowser = (browserTabsByWorktree?.[worktreeId] ?? []).length > 0
  // Why: a running agent keeps the workspace visible through brief PTY gaps
  // such as an SSH reconnect or an unmounted remote pane. #7197
  const hasLiveAgent = worktreeIdsWithLiveAgent.has(worktreeId)
  // Why not folded into hasLiveTerminal: a structured chat has no PTY and no entry in
  // tabsByWorktree, so every terminal-shaped signal above reads it as absent.
  const hasStructuredChat = worktreeIdsWithStructuredChat.has(worktreeId)
  return hasLiveTerminal || hasBrowser || hasLiveAgent || hasStructuredChat
}

export function isInactiveWorkspace(
  worktreeId: string,
  tabsByWorktree: TabsByWorktree | null | undefined,
  ptyIdsByTabId: PtyIdsByTabId | null | undefined,
  browserTabsByWorktree: BrowserTabsByWorktree | null | undefined,
  worktreeIdsWithLiveAgent: ReadonlySet<string>,
  worktreeIdsWithStructuredChat: ReadonlySet<string> = EMPTY_WORKTREE_IDS,
  terminalLayoutsByTabId?: TerminalLayoutsByTabId | null
): boolean {
  return !hasActiveWorkspaceActivity(
    worktreeId,
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree,
    worktreeIdsWithLiveAgent,
    worktreeIdsWithStructuredChat,
    terminalLayoutsByTabId
  )
}
