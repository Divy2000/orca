import type { AppState } from '@/store/types'
import type { PaneForegroundAgentEntry } from '@/store/slices/pane-foreground-agent'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab
} from '../../../../shared/terminal-tab-types'
import { createWorktreeRecordSelector } from '@/store/worktree-record-selector-cache'
import {
  buildTerminalPaneHomeIndex,
  selectHomedTerminalLayouts
} from '@/lib/terminal-pane-home-index'
import {
  collectForeignLeafIdsByTabId,
  collectHomedPaneStatusInputs,
  omitForeignPanePtyIds,
  omitForeignPaneTitles,
  type HomedPaneStatusInputs
} from '@/lib/terminal-host-native-pane-inputs'

// Why: these selectors return fresh maps whose top-level values preserve
// underlying per-tab references, so callers must compare them shallowly.

// Why frozen: one instance is shared by every card, so a stray write would leak
// across worktrees instead of failing locally.
export const EMPTY_RUNTIME_PANE_TITLES: Record<string, Record<number, string>> = Object.freeze({})
export const EMPTY_LIVE_PTY_IDS: Record<string, string[]> = Object.freeze({})
export const EMPTY_PANE_FOREGROUND_AGENTS: Record<string, PaneForegroundAgentEntry> = Object.freeze(
  {}
)
export const EMPTY_TERMINAL_LAYOUT_ROOTS: Record<
  string,
  TerminalPaneLayoutNode | null | undefined
> = Object.freeze({})

type WorktreeCardStatusInputState = Pick<AppState, 'runtimePaneTitlesByTabId' | 'ptyIdsByTabId'> & {
  tabsByWorktree: Record<string, readonly { id: string }[]>
}

type WorktreeCardForegroundInputState = Partial<Pick<AppState, 'paneForegroundAgentByPaneKey'>> & {
  tabsByWorktree: Record<string, readonly { id: string }[]>
}

type WorktreeCardLayoutRootInputState = Pick<AppState, 'terminalLayoutsByTabId'> & {
  tabsByWorktree: Record<string, readonly { id: string }[]>
}

export const selectRuntimePaneTitlesForWorktree = createWorktreeRecordSelector<
  WorktreeCardStatusInputState,
  Record<string, Record<number, string>>
>({
  readSources: (state) => [state.tabsByWorktree, state.runtimePaneTitlesByTabId],
  empty: EMPTY_RUNTIME_PANE_TITLES,
  build: (state, worktreeId) => {
    const out: Record<string, Record<number, string>> = {}
    for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
      const paneTitles = state.runtimePaneTitlesByTabId[tab.id]
      if (paneTitles) {
        out[tab.id] = paneTitles
      }
    }
    return out
  }
})

export const selectLivePtyIdsForWorktree = createWorktreeRecordSelector<
  WorktreeCardStatusInputState,
  Record<string, string[]>
>({
  readSources: (state) => [state.tabsByWorktree, state.ptyIdsByTabId],
  empty: EMPTY_LIVE_PTY_IDS,
  build: (state, worktreeId) => {
    const out: Record<string, string[]> = {}
    for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
      const ids = state.ptyIdsByTabId[tab.id]
      if (ids && ids.length > 0) {
        out[tab.id] = ids
      }
    }
    return out
  }
})

type PaneForegroundAgentsByTabId = ReadonlyMap<
  string,
  readonly [string, PaneForegroundAgentEntry][]
>

// Why: grouped once per map identity so each card walks only its own tabs, not every pane key.
const paneForegroundAgentsByTabIdCache = new WeakMap<
  Record<string, PaneForegroundAgentEntry>,
  PaneForegroundAgentsByTabId
>()

function getPaneForegroundAgentsByTabId(
  entries: Record<string, PaneForegroundAgentEntry>
): PaneForegroundAgentsByTabId {
  const cached = paneForegroundAgentsByTabIdCache.get(entries)
  if (cached) {
    return cached
  }
  const byTabId = new Map<string, [string, PaneForegroundAgentEntry][]>()
  for (const [paneKey, entry] of Object.entries(entries)) {
    const tabId = parsePaneKey(paneKey)?.tabId
    if (!tabId) {
      continue
    }
    const group = byTabId.get(tabId)
    if (group) {
      group.push([paneKey, entry])
    } else {
      byTabId.set(tabId, [[paneKey, entry]])
    }
  }
  paneForegroundAgentsByTabIdCache.set(entries, byTabId)
  return byTabId
}

/** This worktree's pane foreground-process reads, keyed by pane key. */
export const selectPaneForegroundAgentsForWorktree = createWorktreeRecordSelector<
  WorktreeCardForegroundInputState,
  Record<string, PaneForegroundAgentEntry>
>({
  readSources: (state) => [state.tabsByWorktree, state.paneForegroundAgentByPaneKey],
  empty: EMPTY_PANE_FOREGROUND_AGENTS,
  build: (state, worktreeId) => {
    const tabs = state.tabsByWorktree[worktreeId]
    if (!tabs?.length || !state.paneForegroundAgentByPaneKey) {
      return EMPTY_PANE_FOREGROUND_AGENTS
    }
    const byTabId = getPaneForegroundAgentsByTabId(state.paneForegroundAgentByPaneKey)
    const out: Record<string, PaneForegroundAgentEntry> = {}
    for (const tab of tabs) {
      for (const [paneKey, entry] of byTabId.get(tab.id) ?? []) {
        out[paneKey] = entry
      }
    }
    return out
  }
})

export const selectTerminalLayoutRootsForWorktree = createWorktreeRecordSelector<
  WorktreeCardLayoutRootInputState,
  Record<string, TerminalPaneLayoutNode | null | undefined>
>({
  readSources: (state) => [state.tabsByWorktree, state.terminalLayoutsByTabId],
  empty: EMPTY_TERMINAL_LAYOUT_ROOTS,
  build: (state, worktreeId) => {
    const out: Record<string, TerminalPaneLayoutNode | null | undefined> = {}
    for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
      out[tab.id] = state.terminalLayoutsByTabId[tab.id]?.root
    }
    return out
  }
})

export function selectTerminalLayoutRootsForWorktrees(
  state: WorktreeCardLayoutRootInputState,
  worktreeIds: readonly string[]
): Record<string, TerminalPaneLayoutNode | null | undefined> {
  const out: Record<string, TerminalPaneLayoutNode | null | undefined> = {}
  for (const worktreeId of worktreeIds) {
    for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
      out[tab.id] = state.terminalLayoutsByTabId[tab.id]?.root
    }
  }
  return out
}

type StatusPaneTab = Pick<TerminalTab, 'id' | 'title' | 'launchAgent'>

export type WorktreeStatusPaneInputs = {
  tabs: readonly StatusPaneTab[]
  ptyIdsByTabId: Record<string, string[]>
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>
  terminalLayoutRootsByTabId: Record<string, TerminalPaneLayoutNode | null | undefined>
}

export type HostedPaneStatusInputs = {
  homedLayouts: Record<string, TerminalLayoutSnapshot>
  /** Panes this worktree owns inside other workspaces' tabs, or null when it has none. */
  homed: HomedPaneStatusInputs | null
  runtimePaneTitleLeafIdsByTabId: Readonly<Record<string, Record<number, string>>>
}

type HostedPaneStatusInputState = Pick<
  AppState,
  'runtimePaneTitlesByTabId' | 'ptyIdsByTabId' | 'terminalLayoutsByTabId'
> &
  Partial<Pick<AppState, 'runtimePaneTitleLeafIdsByTabId'>> & {
    tabsByWorktree: Record<string, readonly { id: string }[]>
  }

const EMPTY_PANE_TITLE_LEAF_IDS: Readonly<Record<string, Record<number, string>>> = Object.freeze(
  {}
)
const EMPTY_HOSTED_PANE_STATUS_INPUTS: HostedPaneStatusInputs = Object.freeze({
  homedLayouts: Object.freeze({}),
  homed: null,
  runtimePaneTitleLeafIdsByTabId: EMPTY_PANE_TITLE_LEAF_IDS
})

/** The cross-workspace pane facts a worktree's status needs; stable while no pane is hosted. */
export const selectHostedPaneStatusInputs = createWorktreeRecordSelector<
  HostedPaneStatusInputState,
  HostedPaneStatusInputs
>({
  readSources: (state) => [
    state.tabsByWorktree,
    selectHomedTerminalLayouts(state.terminalLayoutsByTabId),
    state.ptyIdsByTabId,
    state.runtimePaneTitlesByTabId,
    state.runtimePaneTitleLeafIdsByTabId
  ],
  empty: EMPTY_HOSTED_PANE_STATUS_INPUTS,
  build: (state, worktreeId) => {
    const homedLayouts = selectHomedTerminalLayouts(state.terminalLayoutsByTabId)
    const runtimePaneTitleLeafIdsByTabId =
      state.runtimePaneTitleLeafIdsByTabId ?? EMPTY_PANE_TITLE_LEAF_IDS
    return {
      homedLayouts,
      homed: collectHomedPaneStatusInputs(
        buildTerminalPaneHomeIndex(state.tabsByWorktree, homedLayouts),
        worktreeId,
        homedLayouts,
        state.ptyIdsByTabId,
        state.runtimePaneTitlesByTabId,
        runtimePaneTitleLeafIdsByTabId
      ),
      runtimePaneTitleLeafIdsByTabId
    }
  }
})

/**
 * The terminal inputs a worktree's status dot reads: its own tabs minus panes they only host,
 * plus the panes it owns inside other workspaces' tabs. Returns `own` unchanged when neither applies.
 */
export function resolveWorktreeStatusPaneInputs(
  own: WorktreeStatusPaneInputs,
  worktreeId: string,
  hosted: HostedPaneStatusInputs
): WorktreeStatusPaneInputs {
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
  const { homed } = hosted
  if (!homed) {
    return ptyIdsByTabId === own.ptyIdsByTabId &&
      runtimePaneTitlesByTabId === own.runtimePaneTitlesByTabId
      ? own
      : { ...own, ptyIdsByTabId, runtimePaneTitlesByTabId }
  }
  return {
    tabs: [...own.tabs, ...homed.tabs],
    ptyIdsByTabId: { ...ptyIdsByTabId, ...homed.ptyIdsByTabId },
    runtimePaneTitlesByTabId: { ...runtimePaneTitlesByTabId, ...homed.runtimePaneTitlesByTabId },
    terminalLayoutRootsByTabId: {
      ...own.terminalLayoutRootsByTabId,
      ...homed.terminalLayoutRootsByTabId
    }
  }
}
