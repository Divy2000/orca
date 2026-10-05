import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { createStoreCascadesMockApi } from './store-cascades-test-harness'
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
} from '@/components/terminal-pane/terminal-pane-move-test-fixture'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn(() => [])
}))

vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return {
    ...actual,
    detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
  }
})

const mockApi = createStoreCascadesMockApi()

/** tab-b in B hosts LEAF_MOVED, whose home is A. */
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
    }
  ])
}

function killedPtyIds(): string[] {
  return mockApi.pty.kill.mock.calls.map((call: unknown[]) => String(call[0]))
}

describe('shutdownWorktreeTerminals cross-workspace panes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('given a sleeping workspace that hosts a foreign pane then that pane goes home alive', async () => {
    const store = mixedStore()

    await store.getState().shutdownWorktreeTerminals(WT_B, { keepIdentifiers: true })

    expect(killedPtyIds()).toEqual(['pty-target'])
    const homeTabId = tabIdsIn(store, WT_A).find((id) => id !== 'tab-a') ?? ''
    expect(store.getState().terminalLayoutsByTabId[homeTabId]?.ptyIdsByLeafId).toEqual({
      [LEAF_MOVED]: 'pty-moved'
    })
  })

  it('given a sleeping home workspace then its pane hosted elsewhere is pulled home and slept', async () => {
    const store = mixedStore()

    await store.getState().shutdownWorktreeTerminals(WT_A, { keepIdentifiers: true })

    expect(killedPtyIds().sort()).toEqual(['pty-moved', 'pty-sibling'])
    expect(store.getState().terminalLayoutsByTabId['tab-b']?.root).toEqual({
      type: 'leaf',
      leafId: LEAF_TARGET
    })
    expect(tabIdsIn(store, WT_A)).toHaveLength(2)
  })

  it('given a removed home workspace then its pane hosted elsewhere stops with it', async () => {
    const store = mixedStore()

    await store.getState().shutdownWorktreeTerminals(WT_A, { shutdownReason: 'remove-worktree' })

    expect(killedPtyIds().sort()).toEqual(['pty-moved', 'pty-sibling'])
    expect(store.getState().terminalLayoutsByTabId['tab-b']?.ptyIdsByLeafId).toEqual({
      [LEAF_TARGET]: 'pty-target'
    })
  })
})
