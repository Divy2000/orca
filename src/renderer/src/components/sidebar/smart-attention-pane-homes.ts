import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { buildTerminalPaneHomeIndex } from '@/lib/terminal-pane-home-index'
import {
  collectHomedPaneStatusInputs,
  omitForeignPanePtyIds,
  omitForeignPaneTitles
} from '@/lib/terminal-host-native-pane-inputs'
import type { TabPaneInputSources } from './smart-attention'

export type AttentionPaneHomes = {
  /** Sources for each worktree's own tabs, with panes they only host removed. */
  hostSources: TabPaneInputSources
  /** The host tabs and sources carrying `worktreeId`'s panes; no tabs when it has none. */
  homedInputsFor: (worktreeId: string) => {
    tabs: Pick<TerminalTab, 'id' | 'title'>[]
    sources: TabPaneInputSources
  }
}

function filterEntriesByTabId(
  entriesByTabId: ReadonlyMap<string, AgentStatusEntry[]>,
  keep: (entry: AgentStatusEntry) => boolean
): Map<string, AgentStatusEntry[]> {
  const out = new Map<string, AgentStatusEntry[]>()
  for (const [tabId, entries] of entriesByTabId) {
    const kept = entries.filter(keep)
    if (kept.length > 0) {
      out.set(tabId, kept)
    }
  }
  return out
}

/** Rebuckets attention inputs by each pane's home so a hosted pane ranks its home, not the host. */
export function partitionAttentionSourcesByPaneHome(
  sources: TabPaneInputSources,
  tabsByWorktree: Record<string, TerminalTab[]> | null
): AttentionPaneHomes {
  const layouts = sources.terminalLayoutsByTabId
  const titleLeafIds = sources.runtimePaneTitleLeafIdsByTabId ?? {}
  const index = buildTerminalPaneHomeIndex(tabsByWorktree, layouts)
  if (index.foreignLeafIdsByTabId.size === 0) {
    return { hostSources: sources, homedInputsFor: () => ({ tabs: [], sources }) }
  }
  // Why: a remote row's pane key may collide with a local one; only local rows use local homes.
  const homeOf = (entry: AgentStatusEntry): string | undefined =>
    entry.connectionId ? undefined : index.homeWorktreeIdByPaneKey.get(entry.paneKey)
  return {
    hostSources: {
      entriesByTabId: filterEntriesByTabId(sources.entriesByTabId, (entry) => !homeOf(entry)),
      ptyIdsByTabId: omitForeignPanePtyIds(
        sources.ptyIdsByTabId,
        layouts,
        index.foreignLeafIdsByTabId
      ),
      runtimePaneTitlesByTabId: omitForeignPaneTitles(
        sources.runtimePaneTitlesByTabId,
        layouts,
        index.foreignLeafIdsByTabId,
        sources.ptyIdsByTabId,
        titleLeafIds
      ),
      terminalLayoutsByTabId: layouts,
      runtimePaneTitleLeafIdsByTabId: sources.runtimePaneTitleLeafIdsByTabId
    },
    homedInputsFor: (worktreeId) => {
      const homed = collectHomedPaneStatusInputs(
        index,
        worktreeId,
        layouts,
        sources.ptyIdsByTabId,
        sources.runtimePaneTitlesByTabId,
        titleLeafIds
      )
      return homed
        ? {
            tabs: homed.tabs,
            sources: {
              entriesByTabId: filterEntriesByTabId(
                sources.entriesByTabId,
                (entry) => homeOf(entry) === worktreeId
              ),
              ptyIdsByTabId: homed.ptyIdsByTabId,
              runtimePaneTitlesByTabId: homed.runtimePaneTitlesByTabId,
              terminalLayoutsByTabId: layouts,
              runtimePaneTitleLeafIdsByTabId: sources.runtimePaneTitleLeafIdsByTabId
            }
          }
        : { tabs: [], sources }
    }
  }
}
