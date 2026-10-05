import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installForeignOnlyTerminalTabReconciler } from './terminal-pane-foreign-only-reconciliation'
import {
  LEAF_MOVED,
  LEAF_SIBLING,
  LEAF_TARGET,
  WT_A,
  WT_B,
  createMoveTestStore,
  leafLayout,
  pairLayout,
  tabIdsIn
} from './terminal-pane-move-test-fixture'

const HOME_IN_A = {
  worktreeId: WT_A,
  sessionTabId: 'tab-original',
  sessionLeafId: LEAF_MOVED
}

beforeEach(() => {
  vi.stubGlobal('window', {
    api: { pty: { kill: vi.fn(async () => undefined) } }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mixedHostStore() {
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
        homeByLeafId: { [LEAF_MOVED]: HOME_IN_A }
      }
    }
  ])
}

describe('installForeignOnlyTerminalTabReconciler', () => {
  it('given a close that leaves only a foreign pane then that pane goes home and the host tab closes', async () => {
    const store = mixedHostStore()
    const uninstall = installForeignOnlyTerminalTabReconciler(store)

    store.getState().setTabLayout('tab-b', {
      ...leafLayout(LEAF_MOVED, 'pty-moved'),
      homeByLeafId: { [LEAF_MOVED]: HOME_IN_A }
    })
    await Promise.resolve()

    uninstall()
    expect(tabIdsIn(store, WT_B)).toEqual([])
    const homeTabId = tabIdsIn(store, WT_A).find((id) => id !== 'tab-a') ?? ''
    expect(store.getState().terminalLayoutsByTabId[homeTabId]?.ptyIdsByLeafId).toEqual({
      [LEAF_MOVED]: 'pty-moved'
    })
  })

  it('given a close that leaves only a native pane then nothing moves', async () => {
    const store = mixedHostStore()
    const uninstall = installForeignOnlyTerminalTabReconciler(store)

    store.getState().setTabLayout('tab-b', leafLayout(LEAF_TARGET, 'pty-target'))
    await Promise.resolve()

    uninstall()
    expect(tabIdsIn(store, WT_B)).toEqual(['tab-b'])
    expect(tabIdsIn(store, WT_A)).toEqual(['tab-a'])
  })

  it('given a tab that already held one foreign pane then a layout edit does not move it', async () => {
    const store = createMoveTestStore([
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: {
          ...leafLayout(LEAF_MOVED, 'pty-moved'),
          homeByLeafId: { [LEAF_MOVED]: HOME_IN_A }
        }
      }
    ])
    const uninstall = installForeignOnlyTerminalTabReconciler(store)

    store.getState().setTabLayout('tab-b', {
      ...leafLayout(LEAF_MOVED, 'pty-moved'),
      titlesByLeafId: { [LEAF_MOVED]: 'renamed' },
      homeByLeafId: { [LEAF_MOVED]: HOME_IN_A }
    })
    await Promise.resolve()

    uninstall()
    expect(tabIdsIn(store, WT_B)).toEqual(['tab-b'])
  })
})
