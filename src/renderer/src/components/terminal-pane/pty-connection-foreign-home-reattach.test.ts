import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LEAF_2,
  createMockTransport,
  createPane,
  createManager
} from './pty-connection-test-pane-fixtures'
import type { MockTransport } from './pty-connection-test-pane-fixtures'
import { buildPaneConnectionDeps } from './pty-connection-test-deps'
import { createInitialStoreState } from './pty-connection-test-store-fixtures'
import type { StoreState } from './pty-connection-test-store-state'
import {
  installTerminalTestGlobals,
  restoreTerminalTestGlobals
} from './pty-connection-test-environment'

// A pane moved into another workspace's split keeps the PTY its home workspace spawned, and that
// session id names the home worktree, not the host tab's.

const { scheduleRuntimeGraphSync, shouldSeedCacheTimerOnInitialTitle, toastInfo } = vi.hoisted(
  () => ({
    scheduleRuntimeGraphSync: vi.fn(),
    shouldSeedCacheTimerOnInitialTitle: vi.fn(() => false),
    toastInfo: vi.fn()
  })
)

let mockStoreState: StoreState
let transportFactoryQueue: MockTransport[] = []

vi.mock('@/runtime/sync-runtime-graph', () => ({ scheduleRuntimeGraphSync }))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mockStoreState,
    subscribe: () => () => {}
  }
}))

vi.mock('@/lib/agent-status', async (importOriginal) => {
  const { buildAgentStatusModuleMock } = await import('./pty-connection-test-environment')
  return buildAgentStatusModuleMock(await importOriginal<Record<string, unknown>>())
})

vi.mock('./cache-timer-seeding', () => ({ shouldSeedCacheTimerOnInitialTitle }))

vi.mock('sonner', () => ({ toast: { info: toastInfo } }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof React>()
  return {
    ...actual,
    useCallback: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn
  }
})

vi.mock('./pty-transport', () => ({
  createIpcPtyTransport: vi.fn(() => {
    const nextTransport = transportFactoryQueue.shift()
    if (!nextTransport) {
      throw new Error('No mock transport queued')
    }
    return nextTransport
  })
}))

const HOME_WORKTREE_ID = 'repo1::/tmp/home-worktree'
const HOME_SESSION_ID = `${HOME_WORKTREE_ID}@@a1b2c3d4`

function connectMovedPane(
  connectPanePty: (pane: never, manager: never, deps: never) => unknown,
  attributionWorktreeId: string | undefined
): MockTransport {
  const transport = createMockTransport()
  transportFactoryQueue.push(transport)
  const deps = buildPaneConnectionDeps(() => mockStoreState, {
    restoredLeafId: LEAF_2,
    restoredPtyIdByLeafId: { [LEAF_2]: HOME_SESSION_ID },
    ...(attributionWorktreeId ? { attributionWorktreeId } : {})
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the shared pty-connection fixtures stub exactly the pane, manager and deps members connectPanePty reads.
  connectPanePty(createPane(2) as never, createManager(2) as never, deps as never)
  return transport
}

describe('connectPanePty for a leaf whose PTY was spawned by another worktree', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    transportFactoryQueue = []
    mockStoreState = createInitialStoreState(() => mockStoreState)
    installTerminalTestGlobals()
  })

  afterEach(async () => {
    await restoreTerminalTestGlobals()
  })

  it('reattaches to the PTY of the home workspace the leaf is attributed to', async () => {
    const { connectPanePty } = await import('./pty-connection')

    const transport = connectMovedPane(connectPanePty, HOME_WORKTREE_ID)

    expect(transport.connect).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: HOME_SESSION_ID })
    )
  })

  it('still spawns fresh when nothing ties the leaf to the worktree that owns the session', async () => {
    const { connectPanePty } = await import('./pty-connection')

    const transport = connectMovedPane(connectPanePty, undefined)

    expect(transport.connect).toHaveBeenCalledWith(
      expect.not.objectContaining({ sessionId: expect.any(String) })
    )
  })
})
