// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPLIT_TERMINAL_PANE_EVENT, type SplitTerminalPaneDetail } from '@/constants/terminal'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import {
  canMoveTerminalPane,
  moveTerminalPaneIntoSplit
} from './terminal-pane-cross-workspace-move'
import {
  LEAF_C,
  LEAF_MOVED,
  LEAF_SIBLING,
  LEAF_TARGET,
  WT_A,
  WT_B,
  WT_C,
  UNLISTED_HOME,
  addRepoWithoutListedWorktrees,
  createMoveTestStore,
  leafLayout,
  mountFakeTab,
  pairLayout,
  recordCloseTabPlans,
  resetMountedFakeTabs,
  tabIdsIn
} from './terminal-pane-move-test-fixture'

const MOVED_IN_A = makePaneKey('tab-a', LEAF_MOVED)
const TARGET_IN_B = makePaneKey('tab-b', LEAF_TARGET)

let ptyKill: ReturnType<typeof vi.fn>

beforeEach(() => {
  ptyKill = vi.fn(async () => undefined)
  Object.assign(window, { api: { pty: { kill: ptyKill } } })
})

afterEach(() => {
  resetMountedFakeTabs()
  Reflect.deleteProperty(window, 'api')
})

function splitSourceStore() {
  return createMoveTestStore([
    {
      id: 'tab-a',
      worktreeId: WT_A,
      layout: pairLayout([LEAF_SIBLING, 'pty-sibling'], [LEAF_MOVED, 'pty-moved'])
    },
    {
      id: 'tab-b',
      worktreeId: WT_B,
      layout: leafLayout(LEAF_TARGET, 'pty-target')
    }
  ])
}

describe('moveTerminalPaneIntoSplit', () => {
  it('given a native pane then it joins the target split with the same PTY and a home in its workspace', () => {
    const store = splitSourceStore()

    const result = moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, 'right')

    expect(result).toEqual({ ok: true })
    const target = store.getState().terminalLayoutsByTabId['tab-b']
    expect(target?.root).toEqual({
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: LEAF_TARGET },
      second: { type: 'leaf', leafId: LEAF_MOVED }
    })
    expect(target?.ptyIdsByLeafId?.[LEAF_MOVED]).toBe('pty-moved')
    expect(target?.homeByLeafId?.[LEAF_MOVED]).toEqual({
      worktreeId: WT_A,
      sessionTabId: 'tab-a',
      sessionLeafId: LEAF_MOVED,
      slot: { groupId: `group-${WT_A}`, afterTabId: null }
    })
    expect(store.getState().terminalLayoutsByTabId['tab-a']?.root).toEqual({
      type: 'leaf',
      leafId: LEAF_SIBLING
    })
    expect(store.getState().ptyIdsByTabId['tab-b']).toEqual(['pty-target', 'pty-moved'])
    expect(store.getState().tabsByWorktree[WT_B]?.[0]?.ptyId).toBe('pty-target')
    expect(ptyKill).not.toHaveBeenCalled()
  })

  it.each([
    ['left', 'vertical', 'first'],
    ['top', 'horizontal', 'first'],
    ['bottom', 'horizontal', 'second']
  ] as const)('given a %s drop then the pane lands on that side', (zone, direction, side) => {
    const store = splitSourceStore()

    moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, zone)

    const root = store.getState().terminalLayoutsByTabId['tab-b']?.root
    expect(root?.type === 'split' && root.direction).toBe(direction)
    expect(root?.type === 'split' && root[side]).toEqual({
      type: 'leaf',
      leafId: LEAF_MOVED
    })
  })

  it('moves the pane agent status to its new pane key', () => {
    const store = splitSourceStore()
    store.getState().setAgentStatus(MOVED_IN_A, {
      state: 'working',
      prompt: '',
      agentType: 'codex'
    })

    moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, 'right')

    const statuses = store.getState().agentStatusByPaneKey
    expect(statuses[MOVED_IN_A]).toBeUndefined()
    expect(statuses[makePaneKey('tab-b', LEAF_MOVED)]?.state).toBe('working')
  })

  it('given the last pane of its tab then the source tab closes as cleanup without killing the PTY', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: leafLayout(LEAF_MOVED, 'pty-moved')
      },
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: leafLayout(LEAF_TARGET, 'pty-target')
      }
    ])
    const closes = recordCloseTabPlans(store)

    expect(moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, 'right')).toEqual({
      ok: true
    })

    expect(tabIdsIn(store, WT_A)).toEqual([])
    expect(closes).toHaveLength(1)
    expect(closes[0]?.opts).toEqual({
      reason: 'cleanup',
      captureRecentlyClosed: false
    })
    expect(closes[0]?.plan.localOrSshPtyIds).not.toContain('pty-moved')
    expect(closes[0]?.plan.sharedPtyIds).toContain('pty-moved')
    expect(ptyKill).not.toHaveBeenCalled()
    expect(store.getState().terminalLayoutsByTabId['tab-b']?.ptyIdsByLeafId?.[LEAF_MOVED]).toBe(
      'pty-moved'
    )
  })

  it('given the last pane of its tab then its agent status survives the source tab closing', () => {
    const store = createMoveTestStore([
      { id: 'tab-a', worktreeId: WT_A, layout: leafLayout(LEAF_MOVED, 'pty-moved') },
      { id: 'tab-b', worktreeId: WT_B, layout: leafLayout(LEAF_TARGET, 'pty-target') }
    ])
    store
      .getState()
      .setAgentStatus(MOVED_IN_A, { state: 'working', prompt: '', agentType: 'codex' })

    moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, 'right')

    expect(store.getState().agentStatusByPaneKey[makePaneKey('tab-b', LEAF_MOVED)]?.state).toBe(
      'working'
    )
  })

  it('given a second move then the pane keeps its original home identity', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: leafLayout(LEAF_MOVED, 'pty-moved')
      },
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: leafLayout(LEAF_TARGET, 'pty-target')
      },
      { id: 'tab-c', worktreeId: WT_C, layout: leafLayout(LEAF_C, 'pty-c') }
    ])
    moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, 'right')
    const firstHome = store.getState().terminalLayoutsByTabId['tab-b']?.homeByLeafId?.[LEAF_MOVED]

    const result = moveTerminalPaneIntoSplit(
      store.getState,
      makePaneKey('tab-b', LEAF_MOVED),
      makePaneKey('tab-c', LEAF_C),
      'bottom'
    )

    expect(result).toEqual({ ok: true })
    expect(store.getState().terminalLayoutsByTabId['tab-c']?.homeByLeafId?.[LEAF_MOVED]).toEqual(
      firstHome
    )
    expect(store.getState().terminalLayoutsByTabId['tab-b']?.homeByLeafId).toBeUndefined()
  })

  it('given a pane whose recorded home no longer exists then it moves as native to its tab', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: {
          ...pairLayout([LEAF_SIBLING, 'pty-sibling'], [LEAF_MOVED, 'pty-moved']),
          homeByLeafId: {
            [LEAF_MOVED]: {
              worktreeId: 'repo1::/repo/gone',
              sessionTabId: 'tab-gone',
              sessionLeafId: LEAF_MOVED
            }
          }
        }
      },
      { id: 'tab-b', worktreeId: WT_B, layout: leafLayout(LEAF_TARGET, 'pty-target') }
    ])

    moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, 'right')

    const home = store.getState().terminalLayoutsByTabId['tab-b']?.homeByLeafId?.[LEAF_MOVED]
    expect(home?.worktreeId).toBe(WT_A)
    expect(home?.sessionTabId).toBe('tab-a')
  })

  it('given a pane whose home repo is still loading then the move keeps that home', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: {
          ...pairLayout([LEAF_SIBLING, 'pty-sibling'], [LEAF_MOVED, 'pty-moved']),
          homeByLeafId: {
            [LEAF_MOVED]: {
              worktreeId: UNLISTED_HOME,
              sessionTabId: 'tab-0',
              sessionLeafId: LEAF_MOVED
            }
          }
        }
      },
      { id: 'tab-b', worktreeId: WT_B, layout: leafLayout(LEAF_TARGET, 'pty-target') }
    ])
    addRepoWithoutListedWorktrees(store, { authoritative: false })

    moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, 'right')

    expect(store.getState().terminalLayoutsByTabId['tab-b']?.homeByLeafId?.[LEAF_MOVED]).toEqual({
      worktreeId: UNLISTED_HOME,
      sessionTabId: 'tab-0',
      sessionLeafId: LEAF_MOVED
    })
  })

  it('given a move into a tab of its home workspace then the pane is native again', () => {
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
          ...pairLayout([LEAF_TARGET, 'pty-target'], [LEAF_MOVED, 'pty-moved']),
          homeByLeafId: {
            [LEAF_MOVED]: {
              worktreeId: WT_A,
              sessionTabId: 'tab-old',
              sessionLeafId: LEAF_MOVED
            }
          }
        }
      }
    ])

    const result = moveTerminalPaneIntoSplit(
      store.getState,
      makePaneKey('tab-b', LEAF_MOVED),
      makePaneKey('tab-a', LEAF_SIBLING),
      'right'
    )

    expect(result).toEqual({ ok: true })
    const home = store.getState().terminalLayoutsByTabId['tab-a']
    expect(home?.ptyIdsByLeafId?.[LEAF_MOVED]).toBe('pty-moved')
    expect(home?.homeByLeafId).toBeUndefined()
  })

  it('given a mixed split left with only its foreign pane then that pane is sent home', () => {
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
          ...pairLayout([LEAF_TARGET, 'pty-target'], [LEAF_MOVED, 'pty-moved']),
          homeByLeafId: {
            [LEAF_MOVED]: {
              worktreeId: WT_A,
              sessionTabId: 'tab-old',
              sessionLeafId: LEAF_MOVED
            }
          }
        }
      },
      { id: 'tab-c', worktreeId: WT_C, layout: leafLayout(LEAF_C, 'pty-c') }
    ])

    moveTerminalPaneIntoSplit(
      store.getState,
      makePaneKey('tab-b', LEAF_TARGET),
      makePaneKey('tab-c', LEAF_C),
      'right'
    )

    expect(tabIdsIn(store, WT_B)).toEqual([])
    const homeTabs = store.getState().tabsByWorktree[WT_A] ?? []
    expect(homeTabs).toHaveLength(2)
    const sentHome = homeTabs.find((tab) => tab.id !== 'tab-a')
    expect(store.getState().terminalLayoutsByTabId[sentHome?.id ?? '']?.ptyIdsByLeafId).toEqual({
      [LEAF_MOVED]: 'pty-moved'
    })
    expect(ptyKill).not.toHaveBeenCalled()
  })

  it('given a mounted target then the target pane adopts the PTY through a placed split request', () => {
    const store = splitSourceStore()
    const target = mountFakeTab('tab-b', WT_B, [LEAF_TARGET])
    const requests: SplitTerminalPaneDetail[] = []
    const onSplit = (event: Event): void => {
      if (event instanceof CustomEvent) {
        requests.push(event.detail)
        target.leafIdsByPaneId.set(2, LEAF_MOVED)
      }
    }
    window.addEventListener(SPLIT_TERMINAL_PANE_EVENT, onSplit)

    const result = moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, 'left')

    window.removeEventListener(SPLIT_TERMINAL_PANE_EVENT, onSplit)
    expect(result).toEqual({ ok: true })
    expect(requests).toEqual([
      {
        tabId: 'tab-b',
        worktreeId: WT_B,
        paneRuntimeId: 1,
        sourceLeafId: LEAF_TARGET,
        newLeafId: LEAF_MOVED,
        ptyId: 'pty-moved',
        direction: 'vertical',
        placement: 'before',
        movedLeaf: true
      }
    ])
    expect(
      store.getState().terminalLayoutsByTabId['tab-b']?.homeByLeafId?.[LEAF_MOVED]?.worktreeId
    ).toBe(WT_A)
  })

  it('given a mounted source then its renderer pane is detached without closing the PTY', () => {
    const store = splitSourceStore()
    const source = mountFakeTab('tab-a', WT_A, [LEAF_SIBLING, LEAF_MOVED])

    moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, 'right')

    expect(source.persistLayoutSnapshot).toHaveBeenCalled()
    expect(source.manager.detachPaneForExternalMove).toHaveBeenCalledWith(2)
    expect(ptyKill).not.toHaveBeenCalled()
  })
  it('given a mounted target that cannot adopt the pane then the PTY lands in a new tab there', () => {
    const store = splitSourceStore()
    mountFakeTab('tab-b', WT_B, [LEAF_TARGET])
    const targetBefore = store.getState().terminalLayoutsByTabId['tab-b']

    const result = moveTerminalPaneIntoSplit(store.getState, MOVED_IN_A, TARGET_IN_B, 'right')

    expect(result.ok).toBe(true)
    const fallbackTabId = result.ok ? result.fallbackTabId : undefined
    expect(tabIdsIn(store, WT_B)).toEqual(['tab-b', fallbackTabId])
    expect(store.getState().terminalLayoutsByTabId['tab-b']).toEqual(targetBefore)
    const fallback = store.getState().terminalLayoutsByTabId[fallbackTabId ?? '']
    expect(fallback?.ptyIdsByLeafId).toEqual({ [LEAF_MOVED]: 'pty-moved' })
    expect(fallback?.homeByLeafId?.[LEAF_MOVED]?.worktreeId).toBe(WT_A)
    expect(store.getState().ptyIdsByTabId[fallbackTabId ?? '']).toEqual(['pty-moved'])
    expect(ptyKill).not.toHaveBeenCalled()
  })
})

describe('canMoveTerminalPane', () => {
  it('rejects a move within the same tab', () => {
    const store = splitSourceStore()

    expect(
      canMoveTerminalPane(store.getState(), MOVED_IN_A, makePaneKey('tab-a', LEAF_SIBLING))
    ).toEqual({ ok: false, reason: 'same-tab' })
  })

  it('rejects a pane on a different execution host', () => {
    const store = splitSourceStore()
    store.setState({
      repos: [
        ...store.getState().repos,
        {
          id: 'repo-r',
          path: '/r',
          displayName: 'R',
          badgeColor: '#000',
          addedAt: 0,
          executionHostId: 'runtime:env-1'
        }
      ],
      worktreesByRepo: {
        ...store.getState().worktreesByRepo,
        'repo-r': [
          {
            ...store.getState().worktreesByRepo.repo1![1]!,
            id: 'repo-r::/r/b',
            repoId: 'repo-r'
          }
        ]
      },
      tabsByWorktree: {
        ...store.getState().tabsByWorktree,
        [WT_B]: [],
        'repo-r::/r/b': store.getState().tabsByWorktree[WT_B] ?? []
      }
    })

    expect(canMoveTerminalPane(store.getState(), MOVED_IN_A, TARGET_IN_B)).toEqual({
      ok: false,
      reason: 'different-host'
    })
  })

  it('rejects panes on an SSH host', () => {
    const store = splitSourceStore()
    store.setState({
      repos: store.getState().repos.map((repo) => ({
        ...repo,
        connectionId: 'ssh-1',
        executionHostId: 'ssh:ssh-1' as const
      }))
    })

    expect(canMoveTerminalPane(store.getState(), MOVED_IN_A, TARGET_IN_B)).toEqual({
      ok: false,
      reason: 'remote-host'
    })
  })

  it('rejects a remote runtime terminal', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: pairLayout([LEAF_SIBLING, 'pty-sibling'], [LEAF_MOVED, 'remote:env-1@@term-1'])
      },
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: leafLayout(LEAF_TARGET, 'pty-target')
      }
    ])

    expect(canMoveTerminalPane(store.getState(), MOVED_IN_A, TARGET_IN_B)).toEqual({
      ok: false,
      reason: 'remote-terminal'
    })
  })

  it('rejects a target whose live terminal is remote even before its layout records it', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: pairLayout([LEAF_SIBLING, 'pty-sibling'], [LEAF_MOVED, 'pty-moved'])
      },
      { id: 'tab-b', worktreeId: WT_B, layout: leafLayout(LEAF_TARGET, null) }
    ])
    mountFakeTab('tab-b', WT_B, [LEAF_TARGET], { 1: 'remote:env-1@@term-9' })

    expect(canMoveTerminalPane(store.getState(), MOVED_IN_A, TARGET_IN_B)).toEqual({
      ok: false,
      reason: 'remote-terminal'
    })
  })

  it('rejects the native chat leaf', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: {
          ...pairLayout([LEAF_SIBLING, 'pty-sibling'], [LEAF_MOVED, 'pty-moved']),
          chatLeafId: LEAF_MOVED
        }
      },
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: leafLayout(LEAF_TARGET, 'pty-target')
      }
    ])

    expect(canMoveTerminalPane(store.getState(), MOVED_IN_A, TARGET_IN_B)).toEqual({
      ok: false,
      reason: 'native-chat'
    })
  })

  it('rejects a pane whose terminal has not started yet', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: pairLayout([LEAF_SIBLING, 'pty-sibling'], [LEAF_MOVED, null])
      },
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: leafLayout(LEAF_TARGET, 'pty-target')
      }
    ])

    expect(canMoveTerminalPane(store.getState(), MOVED_IN_A, TARGET_IN_B)).toEqual({
      ok: false,
      reason: 'pane-not-ready'
    })
  })

  it('leaves both tabs unchanged when a move is rejected', () => {
    const store = splitSourceStore()
    const before = store.getState().terminalLayoutsByTabId

    expect(
      moveTerminalPaneIntoSplit(
        store.getState,
        MOVED_IN_A,
        makePaneKey('tab-a', LEAF_SIBLING),
        'right'
      )
    ).toEqual({ ok: false, reason: 'same-tab' })
    expect(store.getState().terminalLayoutsByTabId).toBe(before)
  })
})
