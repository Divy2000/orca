// @vitest-environment happy-dom
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type {
  TerminalLayoutSnapshot,
  TerminalLeafHome
} from '../../../../shared/terminal-tab-types'
import { isTerminalLeafId, type TerminalLeafId } from '../../../../shared/stable-pane-id'

const mocks = vi.hoisted(() => {
  const terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot> = {}
  return { state: { terminalLayoutsByTabId, setTabLayout: vi.fn() } }
})

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

import { PaneManager, type ManagedPane } from '@/lib/pane-manager/pane-manager'
import { installTerminalPaneMountEvents } from './terminal-pane-mount-events'
import type { PtyConnectionDeps } from './pty-connection-types'
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

function terminalLeafId(value: string): TerminalLeafId {
  if (!isTerminalLeafId(value)) {
    throw new Error(`Expected a terminal leaf UUID, got ${value}`)
  }
  return value
}

type SplitPane = PaneManager['splitPane']

const createdTerminals: Terminal[] = []

function makeCreatedPane(leafId: string): ManagedPane {
  const paneLeafId = terminalLeafId(leafId)
  const terminal = new Terminal()
  createdTerminals.push(terminal)
  return {
    id: 3,
    leafId: paneLeafId,
    stablePaneId: paneLeafId,
    terminal,
    container: document.createElement('div'),
    linkTooltip: document.createElement('div'),
    fitAddon: new FitAddon(),
    searchAddon: new SearchAddon(),
    serializeAddon: new SerializeAddon()
  }
}

function buildPtyDeps(): PtyConnectionDeps {
  return {
    tabId: 'host-tab',
    worktreeId: HOST,
    mountFollowsTerminalPark: false,
    paneTransportsRef: { current: new Map() },
    paneMode2031Ref: { current: new Map() },
    paneKittyKeyboardModesRef: { current: new Map() },
    paneLastThemeModeRef: { current: new Map() },
    replayingPanesRef: { current: new Map() },
    isActiveRef: { current: true },
    isVisibleRef: { current: true },
    onPtyExitRef: { current: vi.fn() },
    onAgentExitedRef: { current: vi.fn() },
    clearTabPtyId: vi.fn(),
    consumeSuppressedPtyExit: vi.fn(() => false),
    isPtyShutdownPending: vi.fn(() => false),
    updateTabTitle: vi.fn(),
    setRuntimePaneTitle: vi.fn(),
    clearRuntimePaneTitle: vi.fn(),
    updateTabPtyId: vi.fn(),
    markWorktreeUnread: vi.fn(),
    markTerminalTabUnread: vi.fn(),
    markTerminalPaneUnread: vi.fn(),
    clearWorktreeUnread: vi.fn(),
    clearTerminalTabUnread: vi.fn(),
    clearTerminalPaneUnread: vi.fn(),
    onShowSessionRestoredBanner: vi.fn(),
    dispatchNotification: vi.fn(),
    setCacheTimerStartedAt: vi.fn(),
    syncPanePtyLayoutBinding: vi.fn(),
    clearExitedPanePtyLayoutBinding: vi.fn()
  }
}

function install(splitPane: Mock<SplitPane>): () => void {
  const leafIdByPaneId = new Map([
    [1, terminalLeafId(NATIVE_LEAF)],
    [2, terminalLeafId(FOREIGN_LEAF)]
  ])
  const manager = new PaneManager(document.createElement('div'), { linkOpenHint: () => '' })
  vi.spyOn(manager, 'getNumericIdForLeaf').mockImplementation(
    (leafId) => [...leafIdByPaneId].find(([, id]) => id === leafId)?.[0] ?? null
  )
  vi.spyOn(manager, 'getLeafId').mockImplementation((paneId) => leafIdByPaneId.get(paneId) ?? null)
  vi.spyOn(manager, 'splitPane').mockImplementation(splitPane)
  const uninstall = installTerminalPaneMountEvents({
    manager,
    deps: {
      tabId: 'host-tab',
      worktreeId: HOST,
      isActive: true,
      managerRef: { current: manager },
      persistLayoutSnapshot: vi.fn(),
      syncCanExpandState: vi.fn(),
      queueResizeAll: vi.fn()
    },
    ptyDeps: buildPtyDeps()
  })
  return () => {
    uninstall()
    manager.destroy()
  }
}

function homeSeenBySplit(splitPane: Mock<SplitPane>): () => TerminalLeafHome | undefined {
  let seen: TerminalLeafHome | undefined
  splitPane.mockImplementation((_id, _dir, opts) => {
    seen = mocks.state.terminalLayoutsByTabId['host-tab']?.homeByLeafId?.[opts?.leafId ?? '']
    return makeCreatedPane(opts?.leafId ?? '')
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
  for (const terminal of createdTerminals.splice(0)) {
    terminal.dispose()
  }
})

describe('installTerminalPaneMountEvents runtime split requests', () => {
  it('given a split of a foreign pane carrying its home then the new pane is created with that home', () => {
    const splitPane = vi.fn<SplitPane>()
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
    const uninstall = install(vi.fn<SplitPane>(() => null))

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
    const splitPane = vi.fn<SplitPane>()
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
