import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { clearRuntimeCompatibilityCacheForTests } from '../../runtime/runtime-rpc-client'
import { createTestStore, makeTab, makeWorktree, seedStore } from './store-test-helpers'
import { shutdownBufferCaptures } from '@/components/terminal-pane/shutdown-buffer-captures'
import {
  applySleepRuntimeRpcDefault,
  createStoreCascadesMockApi
} from './store-cascades-test-harness'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn(() => [])
}))

vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

const mockApi = createStoreCascadesMockApi()

const HOST = 'repo1::/path/host'
const HOME = 'repo1::/path/home'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'
const FOREIGN_PANE = `host-tab:${FOREIGN_LEAF}`

describe('shutdownCompletedAgentPaneForHibernation for a pane hosted in another workspace tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRuntimeCompatibilityCacheForTests()
    mockApi.pty.kill.mockResolvedValue(undefined)
    applySleepRuntimeRpcDefault(mockApi)
    shutdownBufferCaptures.clear()
  })

  it('given a completed foreign agent then its resume record belongs to the home', async () => {
    const store = createTestStore()
    seedStore(store, {
      worktreesByRepo: {
        repo1: [
          makeWorktree({ id: HOST, repoId: 'repo1', path: '/path/host' }),
          makeWorktree({ id: HOME, repoId: 'repo1', path: '/path/home' })
        ]
      },
      tabsByWorktree: {
        [HOST]: [makeTab({ id: 'host-tab', worktreeId: HOST, title: 'Codex', ptyId: 'pty-a' })],
        [HOME]: []
      },
      terminalLayoutsByTabId: {
        'host-tab': {
          root: {
            type: 'split',
            direction: 'horizontal',
            first: { type: 'leaf', leafId: NATIVE_LEAF },
            second: { type: 'leaf', leafId: FOREIGN_LEAF }
          },
          activeLeafId: NATIVE_LEAF,
          expandedLeafId: null,
          ptyIdsByLeafId: { [NATIVE_LEAF]: 'pty-shell', [FOREIGN_LEAF]: 'pty-agent' },
          homeByLeafId: {
            [FOREIGN_LEAF]: {
              worktreeId: HOME,
              sessionTabId: 'home-tab',
              sessionLeafId: FOREIGN_LEAF
            }
          }
        }
      },
      ptyIdsByTabId: { 'host-tab': ['pty-shell', 'pty-agent'] }
    })
    store.getState().setAgentStatus(
      FOREIGN_PANE,
      {
        state: 'done',
        prompt: 'resume target',
        agentType: 'codex',
        lastAssistantMessage: 'done'
      },
      'Codex',
      { updatedAt: 2000, stateStartedAt: 1000 },
      { tabId: 'host-tab', worktreeId: HOME },
      { providerSession: { key: 'session_id', id: 'target-session' } }
    )

    await store.getState().shutdownCompletedAgentPaneForHibernation(HOST, {
      paneKey: FOREIGN_PANE,
      tabId: 'host-tab',
      leafId: FOREIGN_LEAF,
      ptyId: 'pty-agent',
      homeWorktreeId: HOME
    })

    const state = store.getState()
    expect(mockApi.pty.kill).toHaveBeenCalledWith('pty-agent', { keepHistory: true })
    expect(state.ptyIdsByTabId['host-tab']).toEqual(['pty-shell'])
    expect(state.sleepingAgentSessionsByPaneKey[FOREIGN_PANE]).toMatchObject({
      worktreeId: HOME,
      origin: 'worktree-sleep',
      providerSession: { key: 'session_id', id: 'target-session' }
    })
    expect(state.retainedAgentsByPaneKey[FOREIGN_PANE]?.worktreeId).toBe(HOME)
  })
})
