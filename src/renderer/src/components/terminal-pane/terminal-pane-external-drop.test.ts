import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalLeafHome } from '../../../../shared/terminal-tab-types'
import type * as TabStripDropTargetModule from './terminal-tab-strip-drop-target'
import type * as SplitDropTargetModule from './terminal-pane-split-drop-target'
import type * as HomeDropTargetModule from './terminal-pane-home-drop-target'
import {
  createMoveTestStore,
  LEAF_MOVED,
  LEAF_SIBLING,
  LEAF_TARGET,
  leafLayout,
  pairLayout,
  WT_A,
  WT_B
} from './terminal-pane-move-test-fixture'

const mocks = vi.hoisted(() => ({
  tabStrip: vi.fn(),
  split: vi.fn(),
  home: vi.fn(),
  moveIntoSplit: vi.fn(),
  sendHome: vi.fn()
}))
vi.mock('./terminal-tab-strip-drop-target', async (importOriginal) => ({
  ...(await importOriginal<typeof TabStripDropTargetModule>()),
  resolveTerminalTabStripDropTarget: mocks.tabStrip
}))
vi.mock('./terminal-pane-split-drop-target', async (importOriginal) => ({
  ...(await importOriginal<typeof SplitDropTargetModule>()),
  resolveTerminalPaneSplitDropTarget: mocks.split
}))
vi.mock('./terminal-pane-home-drop-target', async (importOriginal) => ({
  ...(await importOriginal<typeof HomeDropTargetModule>()),
  resolveTerminalPaneHomeDropTarget: mocks.home
}))
vi.mock('./terminal-pane-move-action', () => ({
  requestTerminalPaneMoveIntoSplit: mocks.moveIntoSplit
}))
vi.mock('./terminal-pane-send-home-action', () => ({
  requestTerminalPaneSendHome: mocks.sendHome
}))

import {
  commitTerminalPaneCrossTabDrop,
  resolveTerminalPaneExternalDropTarget
} from './terminal-pane-external-drop'

const RECT: DOMRect = {
  left: 0,
  top: 0,
  right: 10,
  bottom: 10,
  width: 10,
  height: 10,
  x: 0,
  y: 0,
  toJSON: () => ({})
}
const SPLIT_TARGET = {
  kind: 'pane-split' as const,
  id: 'split',
  paneKey: `tab-b:${LEAF_TARGET}`,
  tabId: 'tab-b',
  zone: 'left' as const,
  overlayKind: 'area' as const,
  rect: RECT
}
const HOME_TARGET = { kind: 'pane-home' as const, id: 'pane-home', rect: RECT }
const HOME_IN_A: TerminalLeafHome = {
  worktreeId: WT_A,
  sessionTabId: 'tab-a',
  sessionLeafId: LEAF_MOVED
}

function hostStore(homeByLeafId?: Record<string, TerminalLeafHome>) {
  return createMoveTestStore([
    { id: 'tab-a', worktreeId: WT_A, layout: leafLayout(LEAF_SIBLING, 'pty-a') },
    {
      id: 'tab-host',
      worktreeId: WT_B,
      layout: {
        ...pairLayout([LEAF_MOVED, 'pty-moved'], [LEAF_TARGET, 'pty-target']),
        ...(homeByLeafId ? { homeByLeafId } : {})
      }
    }
  ])
}

function resolveFor(store: ReturnType<typeof hostStore>, leafId: string | null = LEAF_MOVED) {
  return resolveTerminalPaneExternalDropTarget({
    clientX: 5,
    clientY: 5,
    tabId: 'tab-host',
    worktreeId: WT_B,
    sourceLeafId: leafId,
    state: store.getState()
  })
}

beforeEach(() => {
  mocks.tabStrip.mockReturnValue(null)
  mocks.split.mockReturnValue(null)
  mocks.home.mockReturnValue(HOME_TARGET)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveTerminalPaneExternalDropTarget', () => {
  it('given the same workspace’s tab strip under the pointer, it keeps detaching to a tab', () => {
    const strip = { id: 'group', groupId: 'group', worktreeId: WT_B, rect: RECT }
    mocks.tabStrip.mockReturnValue(strip)

    expect(resolveFor(hostStore())).toBe(strip)
  })

  it('given a pane of another tab under the pointer, it targets that pane, excluding its own tab', () => {
    mocks.split.mockReturnValue(SPLIT_TARGET)

    expect(resolveFor(hostStore())).toBe(SPLIT_TARGET)
    expect(mocks.split).toHaveBeenCalledWith({ clientX: 5, clientY: 5, excludeTabId: 'tab-host' })
  })

  it('given a foreign pane over the sidebar, it highlights the sidebar as its way home', () => {
    expect(resolveFor(hostStore({ [LEAF_MOVED]: HOME_IN_A }))).toBe(HOME_TARGET)
  })

  it('given a native pane over the sidebar, it offers no target', () => {
    expect(resolveFor(hostStore())).toBeNull()
    expect(resolveFor(hostStore({ [LEAF_MOVED]: HOME_IN_A }), LEAF_TARGET)).toBeNull()
  })
})

describe('commitTerminalPaneCrossTabDrop', () => {
  it('given a pane target, it moves the dragged pane into that split edge', () => {
    mocks.moveIntoSplit.mockReturnValue(true)

    expect(
      commitTerminalPaneCrossTabDrop({
        tabId: 'tab-host',
        leafId: LEAF_MOVED,
        target: SPLIT_TARGET
      })
    ).toBe(true)

    expect(mocks.moveIntoSplit).toHaveBeenCalledWith(
      `tab-host:${LEAF_MOVED}`,
      SPLIT_TARGET.paneKey,
      'left'
    )
  })

  it('given the sidebar target, it sends the pane home', () => {
    expect(
      commitTerminalPaneCrossTabDrop({ tabId: 'tab-host', leafId: LEAF_MOVED, target: HOME_TARGET })
    ).toBe(true)

    expect(mocks.sendHome).toHaveBeenCalledWith('tab-host', LEAF_MOVED)
  })

  it('given another kind of target or no leaf, it does nothing', () => {
    const strip = { id: 'group', groupId: 'group', worktreeId: WT_B, rect: RECT }

    expect(
      commitTerminalPaneCrossTabDrop({ tabId: 'tab-host', leafId: LEAF_MOVED, target: strip })
    ).toBe(false)
    expect(
      commitTerminalPaneCrossTabDrop({ tabId: 'tab-host', leafId: null, target: SPLIT_TARGET })
    ).toBe(false)
    expect(mocks.moveIntoSplit).not.toHaveBeenCalled()
    expect(mocks.sendHome).not.toHaveBeenCalled()
  })
})
