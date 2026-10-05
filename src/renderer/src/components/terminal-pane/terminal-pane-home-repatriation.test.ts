import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestBackgroundTerminalWorktreeMount: vi.fn()
}))
vi.mock('../terminal/background-terminal-worktree-mount', () => ({
  requestBackgroundTerminalWorktreeMount: mocks.requestBackgroundTerminalWorktreeMount
}))

import { repatriateTerminalPaneHomesForShutdown } from './terminal-pane-home-repatriation'
import {
  LEAF_C,
  LEAF_MOVED,
  LEAF_SIBLING,
  LEAF_TARGET,
  WT_A,
  WT_B,
  WT_C,
  createMoveTestStore,
  leafLayout,
  mountFakeTab,
  pairLayout,
  resetMountedFakeTabs,
  tabIdsIn
} from './terminal-pane-move-test-fixture'

const ptyKill = vi.fn(async () => undefined)

beforeEach(() => {
  vi.stubGlobal('window', { api: { pty: { kill: ptyKill } } })
})

afterEach(() => {
  resetMountedFakeTabs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** tab-b in B hosts LEAF_MOVED whose home is A; tab-c in C hosts nothing foreign. */
function mixedStore() {
  return createMoveTestStore([
    {
      id: 'tab-a',
      worktreeId: WT_A,
      layout: leafLayout(LEAF_SIBLING, 'pty-sibling')
    },
    {
      id: 'tab-b',
      worktreeId: WT_B,
      layout: {
        ...pairLayout([LEAF_TARGET, 'pty-target'], [LEAF_MOVED, 'pty-moved']),
        homeByLeafId: {
          [LEAF_MOVED]: {
            worktreeId: WT_A,
            sessionTabId: 'tab-a0',
            sessionLeafId: LEAF_MOVED
          }
        }
      }
    },
    { id: 'tab-c', worktreeId: WT_C, layout: leafLayout(LEAF_C, 'pty-c') }
  ])
}

function homeTabHolding(store: ReturnType<typeof mixedStore>, worktreeId: string, leafId: string) {
  return tabIdsIn(store, worktreeId).find(
    (tabId) =>
      store.getState().terminalLayoutsByTabId[tabId]?.root?.type === 'leaf' &&
      store.getState().terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId?.[leafId] !== undefined
  )
}

describe('repatriateTerminalPaneHomesForShutdown', () => {
  it('given a workspace that hosts a foreign pane then the pane is sent home alive first', () => {
    const store = mixedStore()
    mountFakeTab('tab-b', WT_B, [LEAF_TARGET, LEAF_MOVED])

    repatriateTerminalPaneHomesForShutdown(store.getState, WT_B)

    const homeTabId = homeTabHolding(store, WT_A, LEAF_MOVED)
    expect(homeTabId).toBeDefined()
    expect(store.getState().terminalLayoutsByTabId[homeTabId ?? '']?.ptyIdsByLeafId).toEqual({
      [LEAF_MOVED]: 'pty-moved'
    })
    expect(store.getState().terminalLayoutsByTabId['tab-b']?.root).toEqual({
      type: 'leaf',
      leafId: LEAF_TARGET
    })
    expect(mocks.requestBackgroundTerminalWorktreeMount).toHaveBeenCalledWith({
      worktreeId: WT_A,
      tabIds: [homeTabId]
    })
    expect(ptyKill).not.toHaveBeenCalled()
  })

  it('given a home workspace whose pane is hosted elsewhere then the pane is pulled back home without mounting', () => {
    const store = mixedStore()
    mountFakeTab('tab-b', WT_B, [LEAF_TARGET, LEAF_MOVED])

    repatriateTerminalPaneHomesForShutdown(store.getState, WT_A)

    const homeTabId = homeTabHolding(store, WT_A, LEAF_MOVED)
    expect(store.getState().ptyIdsByTabId[homeTabId ?? '']).toEqual(['pty-moved'])
    expect(store.getState().terminalLayoutsByTabId['tab-b']?.ptyIdsByLeafId).toEqual({
      [LEAF_TARGET]: 'pty-target'
    })
    expect(mocks.requestBackgroundTerminalWorktreeMount).not.toHaveBeenCalled()
    expect(ptyKill).not.toHaveBeenCalled()
  })

  it('given a workspace with no foreign links then nothing moves', () => {
    const store = mixedStore()
    const layoutsBefore = store.getState().terminalLayoutsByTabId

    repatriateTerminalPaneHomesForShutdown(store.getState, WT_C)

    expect(store.getState().terminalLayoutsByTabId).toBe(layoutsBefore)
    expect(tabIdsIn(store, WT_C)).toEqual(['tab-c'])
  })
})
