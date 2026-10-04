// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalLayoutSnapshot,
  TerminalLeafHome
} from '../../../../shared/terminal-tab-types'

const mocks = vi.hoisted(() => ({
  state: {
    terminalLayoutsByTabId: {} as Record<string, TerminalLayoutSnapshot>,
    setTabLayout: vi.fn()
  }
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/runtime/sync-runtime-graph', () => ({ scheduleRuntimeGraphSync: vi.fn() }))
vi.mock('@/runtime/web-runtime-session', () => ({
  consumePendingWebRuntimeSplitMirrorTelemetry: vi.fn(() => false)
}))
vi.mock('../terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('./terminal-pane-lifecycle-primitives', () => ({
  splitPaneWithOneShotStartup: vi.fn(),
  recordRuntimeCreatedTerminalPaneSplit: vi.fn()
}))

import { installTerminalPaneMountEvents } from './terminal-pane-mount-events'
import {
  _resetTerminalPaneSplitRequestRoutingForTests,
  dispatchTerminalPaneSplitRequest
} from './terminal-pane-split-request-routing'

const HOST = 'repo::/host'
const HOME = 'repo::/home'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'
const NEW_LEAF = '33333333-3333-4333-8333-333333333333'
const home: TerminalLeafHome = {
  worktreeId: HOME,
  sessionTabId: 'home-tab',
  sessionLeafId: FOREIGN_LEAF
}

function install(splitPane: ReturnType<typeof vi.fn>): () => void {
  const paneIdByLeaf = new Map([
    [NATIVE_LEAF, 1],
    [FOREIGN_LEAF, 2]
  ])
  const manager = {
    getNumericIdForLeaf: (leafId: string) => paneIdByLeaf.get(leafId) ?? null,
    getLeafId: (paneId: number) => [...paneIdByLeaf].find(([, id]) => id === paneId)?.[0] ?? null,
    splitPane
  }
  return installTerminalPaneMountEvents({
    manager: manager as never,
    deps: {
      tabId: 'host-tab',
      worktreeId: HOST,
      isActive: true,
      managerRef: { current: manager as never },
      persistLayoutSnapshot: vi.fn(),
      syncCanExpandState: vi.fn(),
      queueResizeAll: vi.fn()
    },
    ptyDeps: {} as never
  })
}

function homeSeenBySplit(splitPane: ReturnType<typeof vi.fn>): () => TerminalLeafHome | undefined {
  let seen: TerminalLeafHome | undefined
  splitPane.mockImplementation((_id: number, _dir: string, opts?: { leafId?: string }) => {
    seen = mocks.state.terminalLayoutsByTabId['host-tab']?.homeByLeafId?.[opts?.leafId ?? '']
    return { id: 3, leafId: opts?.leafId }
  })
  return () => seen
}

beforeEach(() => {
  _resetTerminalPaneSplitRequestRoutingForTests()
  mocks.state.terminalLayoutsByTabId = {
    'host-tab': {
      root: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', leafId: NATIVE_LEAF },
        second: { type: 'leaf', leafId: FOREIGN_LEAF }
      },
      activeLeafId: NATIVE_LEAF,
      expandedLeafId: null,
      homeByLeafId: { [FOREIGN_LEAF]: home }
    }
  }
  mocks.state.setTabLayout.mockReset()
  mocks.state.setTabLayout.mockImplementation((tabId: string, layout: TerminalLayoutSnapshot) => {
    mocks.state.terminalLayoutsByTabId[tabId] = layout
  })
})

afterEach(() => {
  _resetTerminalPaneSplitRequestRoutingForTests()
})

describe('installTerminalPaneMountEvents runtime split requests', () => {
  it('given a split of a foreign pane carrying its home then the new pane is created with that home', () => {
    const splitPane = vi.fn()
    const seen = homeSeenBySplit(splitPane)
    const uninstall = install(splitPane)

    dispatchTerminalPaneSplitRequest({
      tabId: 'host-tab',
      worktreeId: HOST,
      homeWorktreeId: HOME,
      paneRuntimeId: 2,
      sourceLeafId: FOREIGN_LEAF,
      newLeafId: NEW_LEAF,
      direction: 'vertical'
    })

    expect(splitPane).toHaveBeenCalledWith(2, 'vertical', { leafId: NEW_LEAF })
    expect(seen()).toEqual({ ...home, sessionLeafId: NEW_LEAF })
    uninstall()
  })

  it('given a split of a foreign pane that fails then the pre-written home is rolled back', () => {
    const uninstall = install(vi.fn(() => null))

    dispatchTerminalPaneSplitRequest({
      tabId: 'host-tab',
      worktreeId: HOST,
      homeWorktreeId: HOME,
      paneRuntimeId: 2,
      sourceLeafId: FOREIGN_LEAF,
      newLeafId: NEW_LEAF,
      direction: 'vertical'
    })

    expect(Object.keys(mocks.state.terminalLayoutsByTabId['host-tab']?.homeByLeafId ?? {})).toEqual(
      [FOREIGN_LEAF]
    )
    uninstall()
  })

  it('given a split of a native pane then no home is installed', () => {
    const splitPane = vi.fn()
    const seen = homeSeenBySplit(splitPane)
    const uninstall = install(splitPane)

    dispatchTerminalPaneSplitRequest({
      tabId: 'host-tab',
      worktreeId: HOST,
      paneRuntimeId: 1,
      sourceLeafId: NATIVE_LEAF,
      newLeafId: NEW_LEAF,
      direction: 'vertical'
    })

    expect(splitPane).toHaveBeenCalledWith(1, 'vertical', { leafId: NEW_LEAF })
    expect(seen()).toBeUndefined()
    expect(mocks.state.setTabLayout).not.toHaveBeenCalled()
    uninstall()
  })
})
