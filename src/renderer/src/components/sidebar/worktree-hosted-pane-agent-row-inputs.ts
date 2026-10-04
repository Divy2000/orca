import type { AppState } from '@/store/types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/terminal-tab-types'
import { createWorktreeRecordSelector } from '@/store/worktree-record-selector-cache'
import {
  buildTerminalPaneHomeIndex,
  selectHomedTerminalLayouts
} from '@/lib/terminal-pane-home-index'
import {
  collectForeignLeafIdsByTabId,
  collectHomedPaneStatusInputs,
  omitForeignPanePtyIds,
  omitForeignPaneTitles
} from '@/lib/terminal-host-native-pane-inputs'

export type WorktreeAgentRowTerminalInputs = {
  tabs: TerminalTab[]
  ptyIdsByTabId: Record<string, string[]>
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot | undefined>
}

export type HostedAgentRowInputs = WorktreeAgentRowTerminalInputs & {
  homedLayouts: Record<string, TerminalLayoutSnapshot>
  runtimePaneTitleLeafIdsByTabId: Readonly<Record<string, Record<number, string>>>
}

type HostedAgentRowInputState = Pick<
  AppState,
  'tabsByWorktree' | 'terminalLayoutsByTabId' | 'ptyIdsByTabId' | 'runtimePaneTitlesByTabId'
> &
  Partial<Pick<AppState, 'runtimePaneTitleLeafIdsByTabId'>>

export const EMPTY_HOSTED_AGENT_ROW_INPUTS: HostedAgentRowInputs = Object.freeze({
  homedLayouts: Object.freeze({}),
  tabs: Object.freeze([]) as unknown as TerminalTab[],
  ptyIdsByTabId: Object.freeze({}),
  runtimePaneTitlesByTabId: Object.freeze({}),
  terminalLayoutsByTabId: Object.freeze({}),
  runtimePaneTitleLeafIdsByTabId: Object.freeze({})
})

/** The host tabs and their inputs for the panes `worktreeId` owns inside other workspaces' tabs. */
export const selectHostedAgentRowInputs = createWorktreeRecordSelector<
  HostedAgentRowInputState,
  HostedAgentRowInputs
>({
  readSources: (state) => [
    state.tabsByWorktree,
    selectHomedTerminalLayouts(state.terminalLayoutsByTabId),
    state.ptyIdsByTabId,
    state.runtimePaneTitlesByTabId,
    state.runtimePaneTitleLeafIdsByTabId
  ],
  empty: EMPTY_HOSTED_AGENT_ROW_INPUTS,
  build: (state, worktreeId) => {
    const homedLayouts = selectHomedTerminalLayouts(state.terminalLayoutsByTabId)
    const runtimePaneTitleLeafIdsByTabId =
      state.runtimePaneTitleLeafIdsByTabId ??
      EMPTY_HOSTED_AGENT_ROW_INPUTS.runtimePaneTitleLeafIdsByTabId
    const index = buildTerminalPaneHomeIndex(state.tabsByWorktree, homedLayouts)
    const homed = collectHomedPaneStatusInputs(
      index,
      worktreeId,
      homedLayouts,
      state.ptyIdsByTabId,
      state.runtimePaneTitlesByTabId,
      runtimePaneTitleLeafIdsByTabId
    )
    if (!homed) {
      return { ...EMPTY_HOSTED_AGENT_ROW_INPUTS, homedLayouts, runtimePaneTitleLeafIdsByTabId }
    }
    // Why untitled: the host tab's title speaks for its active pane, not for this home's panes.
    const tabs = homed.tabs.flatMap((projected) => {
      const hostWorktreeId = index.hostWorktreeIdByTabId.get(projected.id)
      const tab = hostWorktreeId
        ? state.tabsByWorktree[hostWorktreeId]?.find((candidate) => candidate.id === projected.id)
        : undefined
      return tab ? [{ ...tab, title: '' }] : []
    })
    return {
      homedLayouts,
      runtimePaneTitleLeafIdsByTabId,
      tabs,
      ptyIdsByTabId: homed.ptyIdsByTabId,
      runtimePaneTitlesByTabId: homed.runtimePaneTitlesByTabId,
      terminalLayoutsByTabId: Object.fromEntries(tabs.map((tab) => [tab.id, homedLayouts[tab.id]]))
    }
  }
})

/** A worktree's own agent-row inputs minus panes it only hosts, plus panes it owns elsewhere. */
export function mergeHostedAgentRowInputs(
  own: WorktreeAgentRowTerminalInputs,
  worktreeId: string,
  hosted: HostedAgentRowInputs
): WorktreeAgentRowTerminalInputs {
  const foreignLeafIds = collectForeignLeafIdsByTabId(own.tabs, hosted.homedLayouts, worktreeId)
  const ptyIdsByTabId = omitForeignPanePtyIds(
    own.ptyIdsByTabId,
    hosted.homedLayouts,
    foreignLeafIds
  )
  const runtimePaneTitlesByTabId = omitForeignPaneTitles(
    own.runtimePaneTitlesByTabId,
    hosted.homedLayouts,
    foreignLeafIds,
    own.ptyIdsByTabId,
    hosted.runtimePaneTitleLeafIdsByTabId
  )
  if (hosted.tabs.length === 0) {
    return ptyIdsByTabId === own.ptyIdsByTabId &&
      runtimePaneTitlesByTabId === own.runtimePaneTitlesByTabId
      ? own
      : { ...own, ptyIdsByTabId, runtimePaneTitlesByTabId }
  }
  return {
    tabs: [...own.tabs, ...hosted.tabs],
    ptyIdsByTabId: { ...ptyIdsByTabId, ...hosted.ptyIdsByTabId },
    runtimePaneTitlesByTabId: { ...runtimePaneTitlesByTabId, ...hosted.runtimePaneTitlesByTabId },
    terminalLayoutsByTabId: { ...own.terminalLayoutsByTabId, ...hosted.terminalLayoutsByTabId }
  }
}
