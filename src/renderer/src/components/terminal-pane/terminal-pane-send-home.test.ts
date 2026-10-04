import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalLeafHome } from '../../../../shared/terminal-tab-types'

const mocks = vi.hoisted(() => ({
  requestBackgroundTerminalWorktreeMount: vi.fn()
}))
vi.mock('../terminal/background-terminal-worktree-mount', () => ({
  requestBackgroundTerminalWorktreeMount: mocks.requestBackgroundTerminalWorktreeMount
}))

import { sendTerminalPaneHome } from './terminal-pane-send-home'
import {
  LEAF_MOVED,
  LEAF_SIBLING,
  LEAF_TARGET,
  SSH_HOME,
  UNLISTED_HOME,
  WT_A,
  WT_B,
  addRepoWithoutListedWorktrees,
  addSshWorkspace,
  createMoveTestStore,
  leafLayout,
  mountFakeTab,
  pairLayout,
  recordCloseTabPlans,
  resetMountedFakeTabs,
  tabIdsIn
} from './terminal-pane-move-test-fixture'

const HOME_IN_A: TerminalLeafHome = {
  worktreeId: WT_A,
  sessionTabId: 'tab-original',
  sessionLeafId: LEAF_MOVED
}
const FOREIGN_IN_B = makePaneKey('tab-b', LEAF_MOVED)
const ptyKill = vi.fn(async () => undefined)

beforeEach(() => {
  vi.stubGlobal('window', { api: { pty: { kill: ptyKill } } })
})

afterEach(() => {
  resetMountedFakeTabs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function hostStore(home: TerminalLeafHome = HOME_IN_A) {
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
        titlesByLeafId: { [LEAF_MOVED]: 'agent' },
        homeByLeafId: { [LEAF_MOVED]: home }
      }
    }
  ])
}

function newHomeTabId(store: ReturnType<typeof hostStore>): string {
  return tabIdsIn(store, WT_A).find((id) => id !== 'tab-a') ?? ''
}

describe('sendTerminalPaneHome', () => {
  it('given a foreign pane then an inactive tab in its home adopts the same PTY as a native pane', () => {
    const store = hostStore()
    store.setState({ activeTabIdByWorktree: { [WT_A]: 'tab-a' } })

    const result = sendTerminalPaneHome(store.getState, FOREIGN_IN_B)

    const tabId = newHomeTabId(store)
    expect(result).toEqual({ ok: true, tabId })
    const layout = store.getState().terminalLayoutsByTabId[tabId]
    expect(layout?.root).toEqual({ type: 'leaf', leafId: LEAF_MOVED })
    expect(layout?.ptyIdsByLeafId).toEqual({ [LEAF_MOVED]: 'pty-moved' })
    expect(layout?.titlesByLeafId).toEqual({ [LEAF_MOVED]: 'agent' })
    expect(layout?.homeByLeafId).toBeUndefined()
    expect(store.getState().ptyIdsByTabId[tabId]).toEqual(['pty-moved'])
    expect(store.getState().activeTabIdByWorktree[WT_A]).toBe('tab-a')
    expect(store.getState().terminalLayoutsByTabId['tab-b']?.root).toEqual({
      type: 'leaf',
      leafId: LEAF_TARGET
    })
    expect(mocks.requestBackgroundTerminalWorktreeMount).not.toHaveBeenCalled()
    expect(ptyKill).not.toHaveBeenCalled()
  })

  it('given the last pane of its host tab then the host tab closes and the PTY survives', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: leafLayout(LEAF_SIBLING, 'pty-sibling')
      },
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: {
          ...leafLayout(LEAF_MOVED, 'pty-moved'),
          homeByLeafId: { [LEAF_MOVED]: HOME_IN_A }
        }
      }
    ])
    const closes = recordCloseTabPlans(store)

    expect(sendTerminalPaneHome(store.getState, FOREIGN_IN_B).ok).toBe(true)

    expect(tabIdsIn(store, WT_B)).toEqual([])
    expect(closes.map((close) => [close.tabId, close.opts])).toEqual([
      ['tab-b', { reason: 'cleanup', captureRecentlyClosed: false }]
    ])
    expect(closes[0]?.plan.sharedPtyIds).toEqual(['pty-moved'])
    expect(store.getState().terminalLayoutsByTabId[newHomeTabId(store)]?.ptyIdsByLeafId).toEqual({
      [LEAF_MOVED]: 'pty-moved'
    })
    expect(ptyKill).not.toHaveBeenCalled()
  })

  it('given a mounted host then its pane detaches and the new home tab mounts in the background', () => {
    const store = hostStore()
    const host = mountFakeTab('tab-b', WT_B, [LEAF_TARGET, LEAF_MOVED])

    sendTerminalPaneHome(store.getState, FOREIGN_IN_B)

    expect(host.persistLayoutSnapshot).toHaveBeenCalled()
    expect(host.manager.detachPaneForExternalMove).toHaveBeenCalledWith(2)
    expect(mocks.requestBackgroundTerminalWorktreeMount).toHaveBeenCalledWith({
      worktreeId: WT_A,
      tabIds: [newHomeTabId(store)]
    })
  })

  it('given a recorded slot then the new tab returns to its place in the home group', () => {
    const store = hostStore({
      ...HOME_IN_A,
      slot: { groupId: `group-${WT_A}`, afterTabId: 'tab-a' }
    })
    store.setState({
      groupsByWorktree: {
        ...store.getState().groupsByWorktree,
        [WT_A]: [
          {
            id: `group-${WT_A}`,
            worktreeId: WT_A,
            activeTabId: 'tab-a',
            tabOrder: ['tab-a', 'tab-later']
          }
        ]
      }
    })

    sendTerminalPaneHome(store.getState, FOREIGN_IN_B)

    expect(store.getState().groupsByWorktree[WT_A]?.[0]?.tabOrder).toEqual([
      'tab-a',
      newHomeTabId(store),
      'tab-later'
    ])
  })

  it('given a home recorded with a color and pin then the new home tab gets them back', () => {
    const store = hostStore({ ...HOME_IN_A, color: '#ef4444', isPinned: true })

    sendTerminalPaneHome(store.getState, FOREIGN_IN_B)

    const tabId = newHomeTabId(store)
    expect(store.getState().tabsByWorktree[WT_A]?.find((tab) => tab.id === tabId)?.color).toBe(
      '#ef4444'
    )
    const unified = store.getState().unifiedTabsByWorktree[WT_A]?.find((tab) => tab.id === tabId)
    expect(unified?.color).toBe('#ef4444')
    expect(unified?.isPinned).toBe(true)
  })

  it.each([
    ['no longer exists', 'repo1::/repo/gone'],
    ['is on another host', SSH_HOME]
  ])('given a home workspace that %s then the pane stays and becomes native', (_, homeId) => {
    const store = hostStore({ ...HOME_IN_A, worktreeId: homeId })
    addSshWorkspace(store, SSH_HOME)
    const tabsBefore = store.getState().tabsByWorktree

    expect(sendTerminalPaneHome(store.getState, FOREIGN_IN_B)).toEqual({
      ok: false,
      reason: 'home-unavailable'
    })

    expect(store.getState().tabsByWorktree).toBe(tabsBefore)
    const host = store.getState().terminalLayoutsByTabId['tab-b']
    expect(host?.ptyIdsByLeafId?.[LEAF_MOVED]).toBe('pty-moved')
    expect(host?.homeByLeafId).toBeUndefined()
  })

  it('given a home whose repo is still loading then the home is kept and nothing moves', () => {
    const store = hostStore({ ...HOME_IN_A, worktreeId: UNLISTED_HOME })
    addRepoWithoutListedWorktrees(store, { authoritative: false })
    const layoutsBefore = store.getState().terminalLayoutsByTabId
    const tabsBefore = store.getState().tabsByWorktree

    expect(sendTerminalPaneHome(store.getState, FOREIGN_IN_B)).toEqual({
      ok: false,
      reason: 'home-unknown'
    })

    expect(store.getState().terminalLayoutsByTabId).toBe(layoutsBefore)
    expect(store.getState().tabsByWorktree).toBe(tabsBefore)
  })

  it('given a home authoritatively gone then the pane becomes native without losing its live PTY binding', () => {
    const store = hostStore({ ...HOME_IN_A, worktreeId: UNLISTED_HOME })
    addRepoWithoutListedWorktrees(store, { authoritative: true })
    const stored = store.getState().terminalLayoutsByTabId['tab-b']!
    const { [LEAF_MOVED]: _unpersisted, ...persistedPtyIds } = stored.ptyIdsByLeafId ?? {}
    store.getState().setTabLayout('tab-b', { ...stored, ptyIdsByLeafId: persistedPtyIds })
    const host = mountFakeTab('tab-b', WT_B, [LEAF_TARGET, LEAF_MOVED], { 2: 'pty-live' })
    host.persistLayoutSnapshot.mockImplementation(() => {
      const current = store.getState().terminalLayoutsByTabId['tab-b']!
      store.getState().setTabLayout('tab-b', {
        ...current,
        ptyIdsByLeafId: { ...current.ptyIdsByLeafId, [LEAF_MOVED]: 'pty-live' }
      })
    })

    expect(sendTerminalPaneHome(store.getState, FOREIGN_IN_B)).toEqual({
      ok: false,
      reason: 'home-unavailable'
    })

    const layout = store.getState().terminalLayoutsByTabId['tab-b']
    expect(layout?.ptyIdsByLeafId?.[LEAF_MOVED]).toBe('pty-live')
    expect(layout?.homeByLeafId).toBeUndefined()
  })

  it('rejects a pane that is native to its tab', () => {
    const store = hostStore()

    expect(sendTerminalPaneHome(store.getState, makePaneKey('tab-b', LEAF_TARGET))).toEqual({
      ok: false,
      reason: 'not-foreign'
    })
    expect(tabIdsIn(store, WT_A)).toEqual(['tab-a'])
  })
})
