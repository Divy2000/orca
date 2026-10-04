// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import type { DragEndEvent, DragMoveEvent } from '@dnd-kit/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TabDragItemData } from './tab-drag-data'

const mocks = vi.hoisted(() => ({
  resolveSplitTarget: vi.fn(),
  moveIntoSplit: vi.fn(),
  showOverlay: vi.fn(),
  removeOverlay: vi.fn(),
  activePaneKey: vi.fn(),
  getState: vi.fn(() => ({ terminalLayoutsByTabId: {} }))
}))
vi.mock('../terminal-pane/terminal-pane-split-drop-target', () => ({
  resolveTerminalPaneSplitDropTarget: mocks.resolveSplitTarget
}))
vi.mock('../terminal-pane/terminal-pane-move-action', () => ({
  requestTerminalPaneMoveIntoSplit: mocks.moveIntoSplit
}))
vi.mock('../terminal-pane/terminal-session-drop', () => ({
  showTerminalSessionDropOverlay: mocks.showOverlay,
  removeTerminalSessionDropOverlay: mocks.removeOverlay,
  resolveTerminalTabActivePaneKey: mocks.activePaneKey
}))
vi.mock('../../store', () => ({ useAppStore: { getState: mocks.getState } }))

import { useTabDragPaneMix } from './use-tab-drag-pane-mix'

const SOURCE_KEY = 'term-1:11111111-1111-4111-8111-111111111111'
const TARGET = { kind: 'pane-split', paneKey: 'term-2:x', zone: 'bottom', tabId: 'term-2' }

function tabDrag(tabType: TabDragItemData['tabType'] = 'terminal'): TabDragItemData {
  return {
    kind: 'tab',
    worktreeId: 'wt',
    groupId: 'group-1',
    unifiedTabId: 'unified-1',
    visibleTabId: 'term-1',
    tabType,
    label: 'Terminal'
  }
}

function dragEvent(drag: TabDragItemData, x = 400, y = 300): DragMoveEvent & DragEndEvent {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads only active data, the activator point and the delta.
  return {
    active: { data: { current: drag }, rect: { current: { initial: null } } },
    activatorEvent: { clientX: 0, clientY: 0, shiftKey: false },
    delta: { x, y },
    over: null
  } as unknown as DragMoveEvent & DragEndEvent
}

function pressShift(shiftKey: boolean): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent(shiftKey ? 'keydown' : 'keyup', { shiftKey }))
  })
}

beforeEach(() => {
  mocks.activePaneKey.mockReturnValue(SOURCE_KEY)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useTabDragPaneMix', () => {
  it('given Shift held over another tab’s pane, it shows that edge and mixes the tab’s pane in after the drag ends', () => {
    mocks.resolveSplitTarget.mockReturnValue(TARGET)
    mocks.activePaneKey.mockReturnValue(SOURCE_KEY)
    const { result } = renderHook(() => useTabDragPaneMix())
    const drag = tabDrag()

    result.current.begin(drag)
    pressShift(true)

    expect(result.current.update(dragEvent(drag))).toBe(true)
    expect(mocks.resolveSplitTarget).toHaveBeenCalledWith({
      clientX: 400,
      clientY: 300,
      excludeTabId: 'term-1'
    })
    expect(mocks.showOverlay).toHaveBeenLastCalledWith(TARGET)

    const drop = result.current.resolveDrop(dragEvent(drag))
    expect(mocks.moveIntoSplit).not.toHaveBeenCalled()
    result.current.clear()
    drop?.()
    expect(mocks.activePaneKey).toHaveBeenCalledWith(mocks.getState(), 'term-1')
    expect(mocks.moveIntoSplit).toHaveBeenCalledWith(SOURCE_KEY, 'term-2:x', 'bottom')
  })

  it('given a plain drag, it leaves the tab-group behavior alone', () => {
    mocks.resolveSplitTarget.mockReturnValue(TARGET)
    const { result } = renderHook(() => useTabDragPaneMix())
    const drag = tabDrag()

    result.current.begin(drag)

    expect(result.current.update(dragEvent(drag))).toBe(false)
    expect(mocks.showOverlay).toHaveBeenLastCalledWith(null)
    expect(result.current.resolveDrop(dragEvent(drag))).toBeNull()
    expect(mocks.moveIntoSplit).not.toHaveBeenCalled()
  })

  it('given Shift released mid-drag, it goes back to the tab-group behavior', () => {
    mocks.resolveSplitTarget.mockReturnValue(TARGET)
    const { result } = renderHook(() => useTabDragPaneMix())
    const drag = tabDrag()
    result.current.begin(drag)
    pressShift(true)
    pressShift(false)

    expect(result.current.update(dragEvent(drag))).toBe(false)
  })

  it('given a drag that started with Shift held, it mixes without another key press', () => {
    mocks.resolveSplitTarget.mockReturnValue(TARGET)
    const { result } = renderHook(() => useTabDragPaneMix())
    const drag = tabDrag()

    result.current.begin(drag, { shiftKey: true })

    expect(result.current.update(dragEvent(drag))).toBe(true)
  })

  it('given a non-terminal tab, Shift does nothing special', () => {
    mocks.resolveSplitTarget.mockReturnValue(TARGET)
    const { result } = renderHook(() => useTabDragPaneMix())
    const drag = tabDrag('editor')
    result.current.begin(drag)
    pressShift(true)

    expect(result.current.update(dragEvent(drag))).toBe(false)
    expect(result.current.resolveDrop(dragEvent(drag))).toBeNull()
  })

  it('given a terminal tab with no live pane, Shift offers no pane target', () => {
    mocks.resolveSplitTarget.mockReturnValue(TARGET)
    mocks.activePaneKey.mockReturnValue(null)
    const { result } = renderHook(() => useTabDragPaneMix())
    const drag = tabDrag()
    result.current.begin(drag, { shiftKey: true })

    expect(result.current.update(dragEvent(drag))).toBe(false)
    expect(result.current.resolveDrop(dragEvent(drag))).toBeNull()
  })

  it('given no pane under the pointer, it falls back to the tab-group behavior', () => {
    mocks.resolveSplitTarget.mockReturnValue(null)
    const { result } = renderHook(() => useTabDragPaneMix())
    const drag = tabDrag()
    result.current.begin(drag)
    pressShift(true)

    expect(result.current.update(dragEvent(drag))).toBe(false)
    expect(result.current.resolveDrop(dragEvent(drag))).toBeNull()
  })

  it('given the drag ends, it removes the overlay and stops tracking Shift', () => {
    mocks.resolveSplitTarget.mockReturnValue(TARGET)
    const { result } = renderHook(() => useTabDragPaneMix())
    const drag = tabDrag()
    result.current.begin(drag)

    result.current.clear()
    pressShift(true)

    expect(mocks.removeOverlay).toHaveBeenCalled()
    expect(result.current.update(dragEvent(drag))).toBe(false)
  })
})
