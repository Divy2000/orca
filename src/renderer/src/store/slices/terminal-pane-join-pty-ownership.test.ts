import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { createTestStore, makeTab, makeWorktree, seedStore } from './store-test-helpers'

const SOURCE_WT = 'repo::/repo/source'
const TARGET_WT = 'repo::/repo/target'
const MOVED_LEAF = '11111111-1111-4111-8111-111111111111'
const SURVIVOR_LEAF = '22222222-2222-4222-8222-222222222222'
const TARGET_LEAF = '33333333-3333-4333-8333-333333333333'

function seedJoin() {
  const store = createTestStore()
  seedStore(store, {
    worktreesByRepo: {
      repo: [
        makeWorktree({ id: SOURCE_WT, repoId: 'repo', path: '/repo/source' }),
        makeWorktree({ id: TARGET_WT, repoId: 'repo', path: '/repo/target' })
      ]
    },
    tabsByWorktree: {
      [SOURCE_WT]: [
        makeTab({
          id: 'tab-source',
          worktreeId: SOURCE_WT,
          ptyId: 'pty-moved'
        })
      ],
      [TARGET_WT]: [
        makeTab({
          id: 'tab-target',
          worktreeId: TARGET_WT,
          ptyId: 'pty-target'
        })
      ]
    },
    ptyIdsByTabId: {
      'tab-source': ['pty-moved', 'pty-survivor'],
      'tab-target': ['pty-target']
    },
    lastKnownRelayPtyIdByTabId: {
      'tab-source': 'pty-moved',
      'tab-target': 'pty-target'
    }
  })
  return store
}

const sourceLayout: TerminalLayoutSnapshot = {
  root: { type: 'leaf', leafId: SURVIVOR_LEAF },
  activeLeafId: SURVIVOR_LEAF,
  expandedLeafId: null,
  ptyIdsByLeafId: { [SURVIVOR_LEAF]: 'pty-survivor' }
}

// The moved leaf is active after the join, which must not make it the target tab's main PTY.
const joinedTargetLayout: TerminalLayoutSnapshot = {
  root: {
    type: 'split',
    direction: 'vertical',
    first: { type: 'leaf', leafId: TARGET_LEAF },
    second: { type: 'leaf', leafId: MOVED_LEAF }
  },
  activeLeafId: MOVED_LEAF,
  expandedLeafId: null,
  ptyIdsByLeafId: { [TARGET_LEAF]: 'pty-target', [MOVED_LEAF]: 'pty-moved' }
}

describe('syncPaneDetachPtyOwnership joining an existing tab', () => {
  it('given a target layout then the target keeps its main PTY and relay hint and gains the moved PTY', () => {
    const store = seedJoin()

    store.getState().syncPaneDetachPtyOwnership({
      detachedLeafId: MOVED_LEAF,
      detachedPtyId: 'pty-moved',
      sourceLayout,
      sourceTabId: 'tab-source',
      targetTabId: 'tab-target',
      targetLayout: joinedTargetLayout
    })

    const state = store.getState()
    expect(state.tabsByWorktree[TARGET_WT]?.[0]?.ptyId).toBe('pty-target')
    expect(state.lastKnownRelayPtyIdByTabId['tab-target']).toBe('pty-target')
    expect(state.ptyIdsByTabId['tab-target']).toEqual(['pty-target', 'pty-moved'])
    expect(state.ptyIdsByTabId['tab-source']).toEqual(['pty-survivor'])
    expect(state.tabsByWorktree[SOURCE_WT]?.[0]?.ptyId).toBe('pty-survivor')
  })

  it('given a target without a main PTY then the joined layout primary becomes its main PTY', () => {
    const store = seedJoin()
    store.setState({
      tabsByWorktree: {
        ...store.getState().tabsByWorktree,
        [TARGET_WT]: [makeTab({ id: 'tab-target', worktreeId: TARGET_WT, ptyId: null })]
      },
      lastKnownRelayPtyIdByTabId: { 'tab-source': 'pty-moved' }
    })

    store.getState().syncPaneDetachPtyOwnership({
      detachedLeafId: MOVED_LEAF,
      detachedPtyId: 'pty-moved',
      sourceLayout,
      sourceTabId: 'tab-source',
      targetTabId: 'tab-target',
      targetLayout: joinedTargetLayout
    })

    const state = store.getState()
    expect(state.tabsByWorktree[TARGET_WT]?.[0]?.ptyId).toBe('pty-moved')
    expect(state.lastKnownRelayPtyIdByTabId['tab-target']).toBe('pty-moved')
  })

  it('moves agent status to the joined pane key', () => {
    const store = seedJoin()
    store.getState().setAgentStatus(`tab-source:${MOVED_LEAF}`, {
      state: 'working',
      prompt: '',
      agentType: 'codex'
    })

    store.getState().syncPaneDetachPtyOwnership({
      detachedLeafId: MOVED_LEAF,
      detachedPtyId: 'pty-moved',
      sourceLayout,
      sourceTabId: 'tab-source',
      targetTabId: 'tab-target',
      targetLayout: joinedTargetLayout
    })

    const state = store.getState()
    expect(state.agentStatusByPaneKey[`tab-source:${MOVED_LEAF}`]).toBeUndefined()
    expect(state.agentStatusByPaneKey[`tab-target:${MOVED_LEAF}`]?.state).toBe('working')
  })
})
