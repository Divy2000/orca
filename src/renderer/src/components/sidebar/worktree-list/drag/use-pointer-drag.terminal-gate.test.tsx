// @vitest-environment happy-dom
import type React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type * as KanbanSidebarDropModule from '../../workspace-kanban-sidebar-drop'
import type * as DragAutoscrollModule from '../../worktree-sidebar-drag-autoscroll'
import type { WorktreeDropCommitContext } from './drop-commit-context'
import { NO_WORKTREE_SIDEBAR_DROP_TARGET, type WorktreeSidebarLineageDropTarget } from './row-state'
import { useWorktreeDragRuntime } from './use-runtime'
import type { WorktreeDragSession } from './use-session'
import { useWorktreePointerDrag } from './use-pointer-drag'

const mocks = vi.hoisted(() => {
  const rects: { current: { worktreeId: string }[] } = { current: [] }
  return { rects, payload: vi.fn() }
})

vi.mock('../../worktree-sidebar-drag-autoscroll', async (importOriginal) => ({
  ...(await importOriginal<typeof DragAutoscrollModule>()),
  getWorktreeSidebarDragRectsForGroup: () => mocks.rects.current
}))
vi.mock('../../workspace-kanban-sidebar-drop', async (importOriginal) => ({
  ...(await importOriginal<typeof KanbanSidebarDropModule>()),
  hasWorkspaceKanbanSidebarDropBoard: () => false
}))
vi.mock('./terminal-session-pointer-drop', () => ({
  resolveWorktreePointerTerminalSessionDrag: mocks.payload
}))

const PAYLOAD = { paneKey: 'tab-a:11111111-1111-4111-8111-111111111111', worktreeId: 'wt-a' }

function makeCtx(
  container: HTMLDivElement,
  sidebarTarget: WorktreeSidebarLineageDropTarget = NO_WORKTREE_SIDEBAR_DROP_TARGET
) {
  return {
    scrollRef: { current: container },
    workspaceStatuses: [],
    worktreeDragGroups: [],
    worktreeDragUnitGroups: [],
    refreshWorktreeDragSession: () => true,
    getEligibleLineageDropTarget: () => sidebarTarget,
    computeWorktreeDrop: () => null,
    computeWorktreeStatusDrop: () => null,
    commitWorktreeLineageParentDrop: vi.fn(() => true),
    clearReorderedWorktreeParents: vi.fn(),
    clearWorktreeDrag: vi.fn(),
    onMoveWorktreesToStatus: vi.fn(),
    onMoveWorktreesToStatusAtIndex: vi.fn(),
    onReorderWorktrees: vi.fn(),
    onPinWorktrees: vi.fn()
  } satisfies WorktreeDropCommitContext
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: pointer-down reads only these session members.
const session = {
  groupKeyByRowKey: new Map([['row-a', 'repo']]),
  getReorderDraggedIds: (ids: readonly string[]) => ids,
  getReorderUnitDraggedIds: (_groupKey: string, ids: readonly string[]) => ids,
  worktreeDragSessionRef: { current: null }
} as unknown as WorktreeDragSession

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: pointer-down reads only id and host identity fields.
const WORKTREE = { id: 'wt-a', repoId: 'repo', path: '/repo/a' } as Worktree

function renderPointerDrag(sidebarTarget?: WorktreeSidebarLineageDropTarget) {
  const container = document.createElement('div')
  const ctx = makeCtx(container, sidebarTarget)
  const view = renderHook(() => {
    const runtime = useWorktreeDragRuntime({
      worktreeDragSessionRef: { current: null },
      statusDropAnchorsRef: { current: new Map() },
      onWorkspaceBoardDragPreviewCancel: vi.fn()
    })
    const drag = useWorktreePointerDrag({
      ctx,
      session,
      runtime,
      scrollRef: { current: container },
      markScrollMovement: vi.fn(),
      selectedWorktreeIds: new Set(),
      selectedWorktrees: [],
      onWorkspaceBoardDragPreviewCommit: vi.fn(),
      onDropWorktreesOnWorkspaceBoard: vi.fn(),
      shouldShowWorkspaceBoardDropIndicator: () => false
    })
    return { runtime, drag }
  })
  return { ...view, ctx }
}

function pressCard(view: ReturnType<typeof renderPointerDrag>): void {
  const row = document.createElement('div')
  document.body.append(row)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: pointer-down reads only these event fields.
  const event = {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    currentTarget: row,
    target: row
  } as unknown as React.PointerEvent<HTMLDivElement>
  act(() => view.result.current.drag.handleWorktreeRowPointerDown(event, WORKTREE, 'row-a'))
}

/** Drags the pressed card past the start threshold and releases it. */
function dragAndRelease(): void {
  act(() => {
    window.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 10, clientY: 60 })
    )
  })
  act(() => {
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 10, clientY: 60 }))
  })
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.clearAllMocks()
  mocks.rects.current = []
})

describe('useWorktreePointerDrag start gate', () => {
  it('given a lone card whose workspace has a movable terminal, it can start a drag', () => {
    mocks.rects.current = [{ worktreeId: 'wt-a' }]
    mocks.payload.mockReturnValue(PAYLOAD)
    const view = renderPointerDrag()

    pressCard(view)

    expect(view.result.current.runtime.worktreePointerDragRef.current).not.toBeNull()
  })

  it('given a lone card whose workspace has no terminal, it can still start a drag', () => {
    mocks.rects.current = [{ worktreeId: 'wt-a' }]
    mocks.payload.mockReturnValue(null)
    const view = renderPointerDrag()

    pressCard(view)

    expect(view.result.current.runtime.worktreePointerDragRef.current).not.toBeNull()
  })

  it('given cards to reorder, it starts a drag with or without a terminal', () => {
    mocks.rects.current = [{ worktreeId: 'wt-a' }, { worktreeId: 'wt-b' }]
    mocks.payload.mockReturnValue(null)
    const view = renderPointerDrag()

    pressCard(view)

    expect(view.result.current.runtime.worktreePointerDragRef.current).not.toBeNull()
  })
})

describe('lone card without a terminal and no board', () => {
  it('given a release over the pin area, it pins the workspace', () => {
    mocks.rects.current = [{ worktreeId: 'wt-a' }]
    mocks.payload.mockReturnValue(null)
    const view = renderPointerDrag({ status: null, isPinDrop: true, lineageParentId: null })

    pressCard(view)
    dragAndRelease()

    expect(view.ctx.onPinWorktrees).toHaveBeenCalledWith(['wt-a'])
  })

  it('given a release over another status section, it moves the workspace there', () => {
    mocks.rects.current = [{ worktreeId: 'wt-a' }]
    mocks.payload.mockReturnValue(null)
    const view = renderPointerDrag({ status: 'done', isPinDrop: false, lineageParentId: null })

    pressCard(view)
    dragAndRelease()

    expect(view.ctx.onMoveWorktreesToStatus).toHaveBeenCalledWith(['wt-a'], 'done')
  })

  it('given a release over a lineage parent, it nests the workspace under it', () => {
    mocks.rects.current = [{ worktreeId: 'wt-a' }]
    mocks.payload.mockReturnValue(null)
    const view = renderPointerDrag({ status: null, isPinDrop: false, lineageParentId: 'wt-parent' })

    pressCard(view)
    dragAndRelease()

    expect(view.ctx.commitWorktreeLineageParentDrop).toHaveBeenCalledWith(['wt-a'], 'wt-parent')
  })
})
