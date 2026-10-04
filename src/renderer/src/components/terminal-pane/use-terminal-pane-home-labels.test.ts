import { describe, expect, it } from 'vitest'
import {
  parseTerminalPaneHomeLabelsKey,
  resolveTerminalPaneHomeLabels,
  selectTerminalPaneHomeLabelsKey
} from './use-terminal-pane-home-labels'
import {
  LEAF_MOVED,
  LEAF_TARGET,
  WT_A,
  WT_B,
  SSH_HOME,
  UNLISTED_HOME,
  addRepoWithoutListedWorktrees,
  addSshWorkspace,
  createMoveTestStore,
  leafLayout
} from './terminal-pane-move-test-fixture'

describe('resolveTerminalPaneHomeLabels', () => {
  it('names the home workspace of each foreign leaf and skips leaves native to the host', () => {
    const store = createMoveTestStore([
      { id: 'tab-b', worktreeId: WT_B, layout: leafLayout(LEAF_TARGET, null) }
    ])

    const labels = resolveTerminalPaneHomeLabels(
      store.getState(),
      {
        [LEAF_MOVED]: {
          worktreeId: WT_A,
          sessionTabId: 'tab-a',
          sessionLeafId: LEAF_MOVED
        },
        [LEAF_TARGET]: {
          worktreeId: WT_B,
          sessionTabId: 'tab-b',
          sessionLeafId: LEAF_TARGET
        }
      },
      WT_B
    )

    expect(labels).toEqual({ [LEAF_MOVED]: WT_A })
  })

  it('hides the action for a home workspace that no longer exists', () => {
    const store = createMoveTestStore([])

    const labels = resolveTerminalPaneHomeLabels(
      store.getState(),
      {
        [LEAF_MOVED]: { worktreeId: 'repo1::/gone', sessionTabId: 't', sessionLeafId: LEAF_MOVED }
      },
      WT_B
    )

    expect(labels).toEqual({})
  })

  it('hides the action for a home workspace on another host', () => {
    const store = createMoveTestStore([])
    addSshWorkspace(store, SSH_HOME)

    const labels = resolveTerminalPaneHomeLabels(
      store.getState(),
      { [LEAF_MOVED]: { worktreeId: SSH_HOME, sessionTabId: 't', sessionLeafId: LEAF_MOVED } },
      WT_B
    )

    expect(labels).toEqual({})
  })

  it('falls back to a generic name when the home workspace has no display name', () => {
    const store = createMoveTestStore([])
    store.setState({
      worktreesByRepo: {
        repo1: store
          .getState()
          .worktreesByRepo.repo1!.map((worktree) =>
            worktree.id === WT_A ? { ...worktree, displayName: '', branch: '' } : worktree
          )
      }
    })

    const labels = resolveTerminalPaneHomeLabels(
      store.getState(),
      { [LEAF_MOVED]: { worktreeId: WT_A, sessionTabId: 't', sessionLeafId: LEAF_MOVED } },
      WT_B
    )

    expect(labels).toEqual({ [LEAF_MOVED]: 'its workspace' })
  })

  it('accepts a home that is only listed as a detected worktree and names it from that row', () => {
    const store = createMoveTestStore([])
    const detectedId = 'repo1::/repo/feature'
    store.setState({
      detectedWorktreesByRepo: {
        repo1: {
          repoId: 'repo1',
          authoritative: true,
          source: 'git',
          worktrees: [
            {
              ...store.getState().worktreesByRepo.repo1![0]!,
              id: detectedId,
              path: '/repo/feature',
              displayName: 'feature',
              ownership: 'external',
              selectedCheckout: false,
              visible: false
            }
          ]
        }
      }
    })

    const labels = resolveTerminalPaneHomeLabels(
      store.getState(),
      { [LEAF_MOVED]: { worktreeId: detectedId, sessionTabId: 't', sessionLeafId: LEAF_MOVED } },
      WT_B
    )

    expect(labels).toEqual({ [LEAF_MOVED]: 'feature' })
  })

  it('keeps a workspace literally named like the fallback instead of another row for it', () => {
    const store = createMoveTestStore([])
    const catalogRow = store.getState().worktreesByRepo.repo1!.find((row) => row.id === WT_A)!
    store.setState({
      worktreesByRepo: {
        repo1: store
          .getState()
          .worktreesByRepo.repo1!.map((row) =>
            row.id === WT_A ? { ...row, displayName: 'its workspace' } : row
          )
      },
      detectedWorktreesByRepo: {
        repo1: {
          repoId: 'repo1',
          authoritative: true,
          source: 'git',
          worktrees: [
            {
              ...catalogRow,
              displayName: '',
              branch: 'main',
              ownership: 'external',
              selectedCheckout: false,
              visible: false
            }
          ]
        }
      }
    })

    const labels = resolveTerminalPaneHomeLabels(
      store.getState(),
      { [LEAF_MOVED]: { worktreeId: WT_A, sessionTabId: 't', sessionLeafId: LEAF_MOVED } },
      WT_B
    )

    expect(labels).toEqual({ [LEAF_MOVED]: 'its workspace' })
  })

  it('round-trips names containing control characters through the selector key', () => {
    const store = createMoveTestStore([])
    const name = 'foo\u0000bar\u0001baz'
    store.setState({
      worktreesByRepo: {
        repo1: store
          .getState()
          .worktreesByRepo.repo1!.map((worktree) =>
            worktree.id === WT_A ? { ...worktree, displayName: name } : worktree
          )
      },
      terminalLayoutsByTabId: {
        'tab-b': {
          ...leafLayout(LEAF_TARGET, null),
          homeByLeafId: {
            [LEAF_MOVED]: { worktreeId: WT_A, sessionTabId: 't', sessionLeafId: LEAF_MOVED }
          }
        }
      }
    })

    const key = selectTerminalPaneHomeLabelsKey(store.getState(), 'tab-b', WT_B)

    expect(parseTerminalPaneHomeLabelsKey(key)).toEqual({ [LEAF_MOVED]: name })
    expect(selectTerminalPaneHomeLabelsKey(store.getState(), 'tab-b', WT_B)).toBe(key)
    expect(selectTerminalPaneHomeLabelsKey(store.getState(), 'tab-none', WT_B)).toBe('')
  })

  it.each([
    ['still loading (non-authoritative empty scan)', { authoritative: false }],
    ['authoritatively gone', { authoritative: true }]
  ])('hides the action while its repo is %s', (_, detection) => {
    const store = createMoveTestStore([])
    addRepoWithoutListedWorktrees(store, detection)

    const labels = resolveTerminalPaneHomeLabels(
      store.getState(),
      { [LEAF_MOVED]: { worktreeId: UNLISTED_HOME, sessionTabId: 't', sessionLeafId: LEAF_MOVED } },
      WT_B
    )

    expect(labels).toEqual({})
  })
})
