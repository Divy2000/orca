import { migrationUnsupportedToAgentStatusEntry } from '@/lib/migration-unsupported-agent-entry'
import type {
  AgentStatusEntry,
  MigrationUnsupportedPtyEntry
} from '../../../../shared/agent-status-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'

/**
 * Build a `tabId → entries[]` index over `agentStatusByPaneKey`, keyed by the paneKey's
 * `tabId` prefix. Built once per sort so each worktree's resolution is O(T), not a full-map scan.
 */
export function buildExplicitEntriesByTabId(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined,
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>
): Map<string, AgentStatusEntry[]> {
  const byTab = new Map<string, AgentStatusEntry[]>()
  const pushEntry = (entry: AgentStatusEntry): void => {
    const parsed = parsePaneKey(entry.paneKey)
    // Why: skip malformed/legacy-numeric paneKeys rather than bucketing unroutable rows under a tab.
    if (!parsed) {
      return
    }
    const bucket = byTab.get(parsed.tabId)
    if (bucket) {
      bucket.push(entry)
    } else {
      byTab.set(parsed.tabId, [entry])
    }
  }
  for (const entry of Object.values(agentStatusByPaneKey ?? {})) {
    pushEntry(entry)
  }
  for (const entry of Object.values(migrationUnsupportedByPtyId ?? {})) {
    const agentEntry = migrationUnsupportedToAgentStatusEntry(entry)
    if (agentEntry) {
      pushEntry(agentEntry)
    }
  }
  return byTab
}

export function buildExplicitEntriesByWorktreeId(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined
): Map<string, AgentStatusEntry[]> {
  const byWorktree = new Map<string, AgentStatusEntry[]>()
  for (const entry of Object.values(agentStatusByPaneKey ?? {})) {
    if (!entry.worktreeId || !parsePaneKey(entry.paneKey)) {
      continue
    }
    const bucket = byWorktree.get(entry.worktreeId)
    if (bucket) {
      bucket.push(entry)
    } else {
      byWorktree.set(entry.worktreeId, [entry])
    }
  }
  return byWorktree
}
