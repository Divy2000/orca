import { vi } from 'vitest'
import type { AppState } from '@/store'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { buildTerminalTabRetirementPlan } from '@/store/slices/terminal-tab-retirement'
import {
  createTestStore,
  makeTab,
  makeTabGroup,
  makeUnifiedTab,
  makeWorktree,
  seedStore
} from '@/store/slices/store-test-helpers'
import { graphState, registeredTerminalTabKey } from '@/runtime/sync-runtime-graph/graph-state'
import type { RegisteredTerminalTab } from '@/runtime/sync-runtime-graph/types'

export const WT_A = 'repo1::/repo/a'
export const WT_B = 'repo1::/repo/b'
export const WT_C = 'repo1::/repo/c'
export const LEAF_MOVED = '11111111-1111-4111-8111-111111111111'
export const LEAF_SIBLING = '22222222-2222-4222-8222-222222222222'
export const LEAF_TARGET = '33333333-3333-4333-8333-333333333333'
export const LEAF_C = '44444444-4444-4444-8444-444444444444'

export type MoveTestStore = ReturnType<typeof createTestStore>

export const SSH_HOME = 'repo-ssh::/remote/home'

/** Adds a workspace whose repo lives on an SSH host. */
export function addSshWorkspace(store: MoveTestStore, worktreeId: string): void {
  const state = store.getState()
  store.setState({
    repos: [
      ...state.repos,
      {
        id: 'repo-ssh',
        path: '/remote',
        displayName: 'Remote',
        badgeColor: '#000',
        addedAt: 0,
        connectionId: 'ssh-1',
        executionHostId: 'ssh:ssh-1'
      }
    ],
    worktreesByRepo: {
      ...state.worktreesByRepo,
      'repo-ssh': [makeWorktree({ id: worktreeId, repoId: 'repo-ssh', path: '/remote/home' })]
    }
  })
}

export const UNLISTED_HOME = 'repo2::/repo2/a'

/** Adds a local repo2 with no listed worktrees and the given detection result for it. */
export function addRepoWithoutListedWorktrees(
  store: MoveTestStore,
  detection: { authoritative: boolean } | null
): void {
  const state = store.getState()
  store.setState({
    repos: [
      ...state.repos,
      {
        id: 'repo2',
        path: '/repo2',
        displayName: 'Repo 2',
        badgeColor: '#000',
        addedAt: 0,
        executionHostId: 'local'
      }
    ],
    worktreesByRepo: { ...state.worktreesByRepo, repo2: [] },
    detectedWorktreesByRepo: detection
      ? {
          ...state.detectedWorktreesByRepo,
          repo2: {
            repoId: 'repo2',
            authoritative: detection.authoritative,
            source: 'git',
            worktrees: []
          }
        }
      : state.detectedWorktreesByRepo
  })
}

export function leafLayout(leafId: string, ptyId: string | null): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId },
    activeLeafId: leafId,
    expandedLeafId: null,
    ...(ptyId ? { ptyIdsByLeafId: { [leafId]: ptyId } } : {})
  }
}

export function pairLayout(
  first: [string, string | null],
  second: [string, string | null]
): TerminalLayoutSnapshot {
  const ptyIdsByLeafId = Object.fromEntries(
    [first, second].filter((entry): entry is [string, string] => entry[1] !== null)
  )
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: first[0] },
      second: { type: 'leaf', leafId: second[0] }
    },
    activeLeafId: first[0],
    expandedLeafId: null,
    ...(Object.keys(ptyIdsByLeafId).length > 0 ? { ptyIdsByLeafId } : {})
  }
}

type SeedTab = {
  id: string
  worktreeId: string
  layout: TerminalLayoutSnapshot
}

/** Seeds local worktrees A, B and C with one tab group each and the given terminal tabs. */
export function createMoveTestStore(tabs: SeedTab[]): MoveTestStore {
  const store = createTestStore()
  const worktreeIds = [WT_A, WT_B, WT_C]
  const tabsIn = (worktreeId: string) => tabs.filter((tab) => tab.worktreeId === worktreeId)
  seedStore(store, {
    worktreesByRepo: {
      repo1: worktreeIds.map((id) =>
        makeWorktree({
          id,
          repoId: 'repo1',
          path: id.split('::')[1],
          displayName: id
        })
      )
    },
    tabsByWorktree: Object.fromEntries(
      worktreeIds.map((worktreeId) => [
        worktreeId,
        tabsIn(worktreeId).map((tab) =>
          makeTab({
            id: tab.id,
            worktreeId,
            ptyId: Object.values(tab.layout.ptyIdsByLeafId ?? {})[0] ?? null
          })
        )
      ])
    ),
    unifiedTabsByWorktree: Object.fromEntries(
      worktreeIds.map((worktreeId) => [
        worktreeId,
        tabsIn(worktreeId).map((tab) =>
          makeUnifiedTab({
            id: tab.id,
            worktreeId,
            groupId: `group-${worktreeId}`
          })
        )
      ])
    ),
    groupsByWorktree: Object.fromEntries(
      worktreeIds.map((worktreeId) => [
        worktreeId,
        [
          makeTabGroup({
            id: `group-${worktreeId}`,
            worktreeId,
            activeTabId: tabsIn(worktreeId)[0]?.id ?? null,
            tabOrder: tabsIn(worktreeId).map((tab) => tab.id)
          })
        ]
      ])
    ),
    activeGroupIdByWorktree: Object.fromEntries(
      worktreeIds.map((worktreeId) => [worktreeId, `group-${worktreeId}`])
    ),
    terminalLayoutsByTabId: Object.fromEntries(tabs.map((tab) => [tab.id, tab.layout])),
    ptyIdsByTabId: Object.fromEntries(
      tabs.map((tab) => [tab.id, Object.values(tab.layout.ptyIdsByLeafId ?? {})])
    )
  })
  return store
}

export function tabIdsIn(store: MoveTestStore, worktreeId: string): string[] {
  return (store.getState().tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id)
}

/** Records the retirement plan each closeTab call saw, so tests can prove a moved PTY was shared. */
export function recordCloseTabPlans(store: MoveTestStore) {
  const closeTab = store.getState().closeTab
  const calls: {
    tabId: string
    opts: Parameters<AppState['closeTab']>[1]
    plan: ReturnType<typeof buildTerminalTabRetirementPlan>
  }[] = []
  store.setState({
    closeTab: (tabId, opts) => {
      calls.push({
        tabId,
        opts,
        plan: buildTerminalTabRetirementPlan(store.getState(), tabId)
      })
      closeTab(tabId, opts)
    }
  })
  return calls
}

type FakeMountedTab = {
  manager: {
    getPanes: () => { id: number }[]
    getLeafId: (paneId: number) => string | null
    getNumericIdForLeaf: (leafId: string) => number | null
    detachPaneForExternalMove: ReturnType<typeof vi.fn<(paneId: number) => boolean>>
  }
  leafIdsByPaneId: Map<number, string>
  persistLayoutSnapshot: ReturnType<typeof vi.fn<() => void>>
}

/** Registers a mounted TerminalPane whose manager holds the given leaves (pane ids 1..n). */
export function mountFakeTab(
  tabId: string,
  worktreeId: string,
  leafIds: string[],
  livePtyIdsByPaneId: Record<number, string> = {}
): FakeMountedTab {
  const leafIdsByPaneId = new Map(leafIds.map((leafId, index) => [index + 1, leafId]))
  const manager: FakeMountedTab['manager'] = {
    getPanes: () => [...leafIdsByPaneId.keys()].map((id) => ({ id })),
    getLeafId: (paneId) => leafIdsByPaneId.get(paneId) ?? null,
    getNumericIdForLeaf: (leafId) =>
      [...leafIdsByPaneId].find(([, candidate]) => candidate === leafId)?.[0] ?? null,
    detachPaneForExternalMove: vi.fn((paneId: number) => leafIdsByPaneId.delete(paneId))
  }
  const persistLayoutSnapshot = vi.fn<() => void>()
  const registered: RegisteredTerminalTab = {
    tabId,
    worktreeId,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the move code calls only the manager methods faked above.
    getManager: () => manager as unknown as PaneManager,
    getContainer: () => null,
    getPtyIdForPane: (paneId) => livePtyIdsByPaneId[paneId] ?? null,
    getTabWideAgentHintLeafId: () => null,
    persistLayoutSnapshot
  }
  graphState.registeredTabs.set(registeredTerminalTabKey(worktreeId, tabId), registered)
  return { manager, leafIdsByPaneId, persistLayoutSnapshot }
}

export function resetMountedFakeTabs(): void {
  graphState.registeredTabs.clear()
}
