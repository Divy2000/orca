// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as WebviewDragPassthroughModule from '../browser-pane/host-guest/webview-drag-passthrough'
import {
  createMoveTestStore,
  LEAF_C,
  LEAF_MOVED,
  LEAF_SIBLING,
  LEAF_TARGET,
  leafLayout,
  pairLayout,
  WT_A,
  WT_B,
  WT_C
} from './terminal-pane-move-test-fixture'
import type { TerminalLeafHome } from '../../../../shared/terminal-tab-types'
import { getWorktreeVisitKey } from '@/lib/worktree-visit-recency'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'

const mocks = vi.hoisted(() => ({
  split: vi.fn(),
  moveIntoSplit: vi.fn(),
  releasePassthrough: vi.fn(),
  acquirePassthrough: vi.fn()
}))
vi.mock('./terminal-pane-split-drop-target', () => ({
  resolveTerminalPaneSplitDropTarget: mocks.split
}))
vi.mock('./terminal-pane-move-action', () => ({
  requestTerminalPaneMoveIntoSplit: mocks.moveIntoSplit
}))
vi.mock('../browser-pane/host-guest/webview-drag-passthrough', async (importOriginal) => ({
  ...(await importOriginal<typeof WebviewDragPassthroughModule>()),
  acquireWebviewsDragPassthrough: mocks.acquirePassthrough
}))

import {
  commitTerminalSessionDrop,
  endTerminalSessionDrag,
  endTerminalSessionPointerDrop,
  resolveTerminalSessionDropTarget,
  resolveWorkspaceTerminalSessionDrag,
  updateTerminalSessionPointerDrop
} from './terminal-session-drop'
import {
  getActiveTerminalSessionDrag,
  writeTerminalSessionDragData
} from '@/lib/terminal-session-drag-data'

const RECT: DOMRect = {
  left: 10,
  top: 20,
  right: 110,
  bottom: 70,
  width: 100,
  height: 50,
  x: 10,
  y: 20,
  toJSON: () => ({})
}
const TARGET = {
  kind: 'pane-split' as const,
  id: 'target',
  paneKey: `tab-b:${LEAF_TARGET}`,
  tabId: 'tab-b',
  zone: 'top' as const,
  overlayKind: 'area' as const,
  rect: RECT
}
const SOURCE_KEY = `tab-a:${LEAF_MOVED}`

function homeIn(worktreeId: string): TerminalLeafHome {
  return { worktreeId, sessionTabId: 'tab-home', sessionLeafId: LEAF_MOVED }
}

function overlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.pane-drop-overlay')
}

afterEach(() => {
  endTerminalSessionPointerDrop()
  endTerminalSessionDrag()
  vi.clearAllMocks()
})

describe('resolveWorkspaceTerminalSessionDrag', () => {
  it('given a workspace, it drags the active pane of its active terminal tab', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: pairLayout([LEAF_SIBLING, 'p1'], [LEAF_MOVED, 'p2'])
      }
    ])
    store.setState({
      activeTabIdByWorktree: { [WT_A]: 'tab-a' },
      terminalLayoutsByTabId: {
        'tab-a': {
          ...pairLayout([LEAF_SIBLING, 'p1'], [LEAF_MOVED, 'p2']),
          activeLeafId: LEAF_MOVED
        }
      }
    })

    expect(resolveWorkspaceTerminalSessionDrag(store.getState(), WT_A)).toEqual({
      paneKey: SOURCE_KEY,
      worktreeId: WT_A
    })
  })

  it('given a workspace with no open terminal, it offers nothing to drag', () => {
    const store = createMoveTestStore([
      { id: 'tab-b', worktreeId: WT_B, layout: leafLayout(LEAF_TARGET, 'pty') }
    ])

    expect(resolveWorkspaceTerminalSessionDrag(store.getState(), WT_A)).toBeNull()
  })

  it('given a remembered active tab that no longer exists, it offers nothing to drag', () => {
    const store = createMoveTestStore([
      { id: 'tab-b', worktreeId: WT_B, layout: leafLayout(LEAF_TARGET, 'pty') }
    ])
    store.setState({ activeTabIdByWorktree: { [WT_A]: 'tab-gone' } })

    expect(resolveWorkspaceTerminalSessionDrag(store.getState(), WT_A)).toBeNull()
  })

  it('given its only terminal hosted in another workspace’s split, it drags that hosted pane', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: {
          ...pairLayout([LEAF_TARGET, 'pty-b'], [LEAF_MOVED, 'pty-a']),
          homeByLeafId: { [LEAF_MOVED]: homeIn(WT_A) }
        }
      }
    ])

    expect(resolveWorkspaceTerminalSessionDrag(store.getState(), WT_A)).toEqual({
      paneKey: `tab-b:${LEAF_MOVED}`,
      worktreeId: WT_A
    })
  })

  it('given an active native terminal and a hosted one, it prefers the native terminal', () => {
    const store = createMoveTestStore([
      { id: 'tab-a', worktreeId: WT_A, layout: leafLayout(LEAF_SIBLING, 'pty-native') },
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: {
          ...pairLayout([LEAF_TARGET, 'pty-b'], [LEAF_MOVED, 'pty-a']),
          homeByLeafId: { [LEAF_MOVED]: homeIn(WT_A) }
        }
      }
    ])
    store.setState({ activeTabIdByWorktree: { [WT_A]: 'tab-a' } })

    expect(resolveWorkspaceTerminalSessionDrag(store.getState(), WT_A)?.paneKey).toBe(
      `tab-a:${LEAF_SIBLING}`
    )
  })

  it('given an active tab focused on a guest pane, it drags the workspace’s own pane there', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-a',
        worktreeId: WT_A,
        layout: {
          ...pairLayout([LEAF_MOVED, 'pty-guest'], [LEAF_SIBLING, 'pty-native']),
          homeByLeafId: { [LEAF_MOVED]: homeIn(WT_C) }
        }
      }
    ])
    store.setState({ activeTabIdByWorktree: { [WT_A]: 'tab-a' } })

    expect(resolveWorkspaceTerminalSessionDrag(store.getState(), WT_A)?.paneKey).toBe(
      `tab-a:${LEAF_SIBLING}`
    )
  })

  it('given panes hosted in several workspaces, it drags the most recently active one', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: {
          ...pairLayout([LEAF_TARGET, 'pty-b'], [LEAF_MOVED, 'pty-a1']),
          homeByLeafId: { [LEAF_MOVED]: homeIn(WT_A) }
        }
      },
      {
        id: 'tab-c',
        worktreeId: WT_C,
        layout: {
          ...pairLayout([LEAF_C, 'pty-c'], [LEAF_SIBLING, 'pty-a2']),
          homeByLeafId: { [LEAF_SIBLING]: homeIn(WT_A) }
        }
      }
    ])
    const visitKey = (worktreeId: string) =>
      getWorktreeVisitKey(worktreeId, getExecutionHostIdForWorktree(store.getState(), worktreeId))
    expect(visitKey(WT_B)).not.toBe(WT_B)
    store.setState({ lastVisitedAtByWorktreeId: { [visitKey(WT_B)]: 100, [visitKey(WT_C)]: 200 } })

    expect(resolveWorkspaceTerminalSessionDrag(store.getState(), WT_A)?.paneKey).toBe(
      `tab-c:${LEAF_SIBLING}`
    )

    store.setState({ lastVisitedAtByWorktreeId: { [visitKey(WT_B)]: 300, [visitKey(WT_C)]: 200 } })

    expect(resolveWorkspaceTerminalSessionDrag(store.getState(), WT_A)?.paneKey).toBe(
      `tab-b:${LEAF_MOVED}`
    )
  })
  it('given legacy bare visit keys, it still ranks hosted panes by host visit', () => {
    const store = createMoveTestStore([
      {
        id: 'tab-b',
        worktreeId: WT_B,
        layout: {
          ...pairLayout([LEAF_TARGET, 'pty-b'], [LEAF_MOVED, 'pty-a1']),
          homeByLeafId: { [LEAF_MOVED]: homeIn(WT_A) }
        }
      },
      {
        id: 'tab-c',
        worktreeId: WT_C,
        layout: {
          ...pairLayout([LEAF_C, 'pty-c'], [LEAF_SIBLING, 'pty-a2']),
          homeByLeafId: { [LEAF_SIBLING]: homeIn(WT_A) }
        }
      }
    ])
    store.setState({ lastVisitedAtByWorktreeId: { [WT_B]: 100, [WT_C]: 200 } })

    expect(resolveWorkspaceTerminalSessionDrag(store.getState(), WT_A)?.paneKey).toBe(
      `tab-c:${LEAF_SIBLING}`
    )

    store.setState({ lastVisitedAtByWorktreeId: { [WT_B]: 300, [WT_C]: 200 } })

    expect(resolveWorkspaceTerminalSessionDrag(store.getState(), WT_A)?.paneKey).toBe(
      `tab-b:${LEAF_MOVED}`
    )
  })
})

describe('resolveTerminalSessionDropTarget', () => {
  it('given a dragged pane, it never offers that pane’s own tab', () => {
    mocks.split.mockReturnValue(TARGET)

    expect(resolveTerminalSessionDropTarget(5, 6, { paneKey: SOURCE_KEY, worktreeId: WT_A })).toBe(
      TARGET
    )
    expect(mocks.split).toHaveBeenCalledWith({ clientX: 5, clientY: 6, excludeTabId: 'tab-a' })
  })
})

describe('commitTerminalSessionDrop', () => {
  it('given a drop on a pane edge, it moves the dragged pane into that split', () => {
    mocks.moveIntoSplit.mockReturnValue(true)

    expect(commitTerminalSessionDrop({ paneKey: SOURCE_KEY, worktreeId: WT_A }, TARGET)).toBe(true)
    expect(mocks.moveIntoSplit).toHaveBeenCalledWith(SOURCE_KEY, TARGET.paneKey, 'top')
  })
})

describe('updateTerminalSessionPointerDrop', () => {
  it('given a workspace card over a pane, it shows the edge overlay and holds webview passthrough', () => {
    mocks.split.mockReturnValue(TARGET)
    mocks.acquirePassthrough.mockReturnValue(mocks.releasePassthrough)

    const target = updateTerminalSessionPointerDrop({
      clientX: 5,
      clientY: 6,
      payload: { paneKey: SOURCE_KEY, worktreeId: WT_A }
    })
    updateTerminalSessionPointerDrop({
      clientX: 5,
      clientY: 7,
      payload: { paneKey: SOURCE_KEY, worktreeId: WT_A }
    })

    expect(target).toBe(TARGET)
    expect(mocks.acquirePassthrough).toHaveBeenCalledTimes(1)
    expect(overlay()?.style).toMatchObject({ left: '10px', top: '20px', width: '100px' })

    endTerminalSessionPointerDrop()

    expect(overlay()).toBeNull()
    expect(mocks.releasePassthrough).toHaveBeenCalledTimes(1)
  })

  it('given the card leaves the panes or is not a terminal drag, it hides the overlay', () => {
    mocks.split.mockReturnValueOnce(TARGET).mockReturnValueOnce(null)
    mocks.acquirePassthrough.mockReturnValue(mocks.releasePassthrough)
    const payload = { paneKey: SOURCE_KEY, worktreeId: WT_A }

    updateTerminalSessionPointerDrop({ clientX: 5, clientY: 6, payload })
    expect(overlay()?.style.display).toBe('')

    expect(updateTerminalSessionPointerDrop({ clientX: 500, clientY: 6, payload })).toBeNull()
    expect(overlay()?.style.display).toBe('none')

    expect(updateTerminalSessionPointerDrop({ clientX: 5, clientY: 6, payload: null })).toBeNull()
    expect(overlay()?.style.display).toBe('none')
  })
})

describe('endTerminalSessionDrag', () => {
  it('given a finished sidebar drag, it forgets the drag and removes the overlay', () => {
    writeTerminalSessionDragData(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: writing touches only these fields.
      { setData: vi.fn(), effectAllowed: 'all' } as unknown as DataTransfer,
      { paneKey: SOURCE_KEY, worktreeId: WT_A }
    )
    mocks.split.mockReturnValue(TARGET)
    updateTerminalSessionPointerDrop({
      clientX: 5,
      clientY: 6,
      payload: getActiveTerminalSessionDrag()
    })

    endTerminalSessionDrag()

    expect(getActiveTerminalSessionDrag()).toBeNull()
    expect(overlay()).toBeNull()
  })
})
