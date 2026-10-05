import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeDropCommitContext } from './drop-commit-context'
import { NO_WORKTREE_SIDEBAR_DROP_TARGET, type WorktreePointerDrag } from './row-state'

const mocks = vi.hoisted(() => {
  const boardTarget: { status: string | null; isPinDrop: boolean; dropIndex: number } = {
    status: null,
    isPinDrop: false,
    dropIndex: 0
  }
  return { boardTarget, payload: vi.fn(), resolveTarget: vi.fn(), commit: vi.fn() }
})

vi.mock('../../workspace-kanban-sidebar-drop', () => ({
  getWorkspaceKanbanSidebarDropGroups: () => [],
  getWorkspaceKanbanSidebarDropTarget: () => mocks.boardTarget,
  isWorkspaceKanbanSidebarDropPointInBoard: () => false,
  resolveWorkspaceKanbanSidebarFullLaneDropIndex: (_status: string, index: number) => index
}))
vi.mock('../../workspace-kanban-card-pointer-drag-dom', () => ({
  resolveWorkspaceKanbanCardDropCommitTarget: ({ currentTarget }: { currentTarget: unknown }) =>
    currentTarget
}))
vi.mock('./terminal-session-pointer-drop', () => ({
  resolveWorktreePointerTerminalSessionDrag: mocks.payload
}))
vi.mock('@/components/terminal-pane/terminal-session-drop', () => ({
  resolveTerminalSessionDropTarget: mocks.resolveTarget,
  commitTerminalSessionDrop: mocks.commit
}))

import { commitWorktreePointerDrop } from './pointer-commit'

const PAYLOAD = { paneKey: 'tab-a:11111111-1111-4111-8111-111111111111', worktreeId: 'wt-a' }
const TARGET = { kind: 'pane-split', paneKey: 'tab-b:x', zone: 'right' }

function commitAt(clientX: number, clientY: number) {
  const ctx = {
    scrollRef: { current: null },
    workspaceStatuses: [],
    worktreeDragGroups: [],
    worktreeDragUnitGroups: [],
    refreshWorktreeDragSession: () => true,
    getEligibleLineageDropTarget: () => NO_WORKTREE_SIDEBAR_DROP_TARGET,
    computeWorktreeDrop: () => ({
      dropIndex: 1,
      dropIndicatorY: 0,
      dropAnchorId: null,
      previewOffsetsByWorktreeId: new Map()
    }),
    computeWorktreeStatusDrop: () => null,
    commitWorktreeLineageParentDrop: () => true,
    clearReorderedWorktreeParents: vi.fn(),
    clearWorktreeDrag: vi.fn(),
    onMoveWorktreesToStatus: vi.fn(),
    onMoveWorktreesToStatusAtIndex: vi.fn(),
    onReorderWorktrees: vi.fn(),
    onPinWorktrees: vi.fn()
  } satisfies WorktreeDropCommitContext
  const onDropWorktreesOnWorkspaceBoard = vi.fn()
  commitWorktreePointerDrop({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: commit reads only clientX/clientY.
    event: { clientX, clientY } as PointerEvent,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: commit reads only the fields set here.
    drag: {
      worktreeId: 'wt-a',
      draggedIds: ['wt-a'],
      reorderDraggedIds: ['wt-a'],
      sourceGroupKey: 'repo',
      latestBoardDropTarget: null,
      latestStatusDropTarget: null
    } as unknown as WorktreePointerDrag,
    ctx,
    onWorkspaceBoardDragPreviewCommit: vi.fn(),
    onDropWorktreesOnWorkspaceBoard
  })
  return { ctx, onDropWorktreesOnWorkspaceBoard }
}

afterEach(() => {
  vi.clearAllMocks()
  mocks.boardTarget = { status: null, isPinDrop: false, dropIndex: 0 }
})

describe('commitWorktreePointerDrop onto a terminal pane', () => {
  it('given a card released on a pane edge, it moves the workspace’s terminal into that split', () => {
    mocks.payload.mockReturnValue(PAYLOAD)
    mocks.resolveTarget.mockReturnValue(TARGET)
    mocks.commit.mockReturnValue(true)

    const { ctx } = commitAt(700, 300)

    expect(mocks.resolveTarget).toHaveBeenCalledWith(700, 300, PAYLOAD)
    expect(mocks.commit).toHaveBeenCalledWith(PAYLOAD, TARGET)
    expect(ctx.onReorderWorktrees).not.toHaveBeenCalled()
    expect(ctx.clearWorktreeDrag).toHaveBeenCalled()
  })

  it('given a card released on the board, the board keeps the drop', () => {
    mocks.boardTarget = { status: 'done', isPinDrop: false, dropIndex: 0 }
    mocks.payload.mockReturnValue(PAYLOAD)
    mocks.resolveTarget.mockReturnValue(TARGET)

    const { onDropWorktreesOnWorkspaceBoard } = commitAt(700, 300)

    expect(onDropWorktreesOnWorkspaceBoard).toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('given a refused move over a pane, it consumes the drop instead of reordering the sidebar', () => {
    mocks.payload.mockReturnValue(PAYLOAD)
    mocks.resolveTarget.mockReturnValue(TARGET)
    mocks.commit.mockReturnValue(false)

    const { ctx } = commitAt(700, 300)

    expect(mocks.commit).toHaveBeenCalled()
    expect(ctx.onReorderWorktrees).not.toHaveBeenCalled()
    expect(ctx.onMoveWorktreesToStatus).not.toHaveBeenCalled()
    expect(ctx.clearWorktreeDrag).toHaveBeenCalled()
  })

  it('given no pane under the release, it reorders in the sidebar as before', () => {
    mocks.payload.mockReturnValue(PAYLOAD)
    mocks.resolveTarget.mockReturnValue(null)

    const { ctx } = commitAt(40, 300)

    expect(mocks.commit).not.toHaveBeenCalled()
    expect(ctx.onReorderWorktrees).toHaveBeenCalled()
  })

  it('given no movable terminal for the card, it never targets a terminal', () => {
    mocks.payload.mockReturnValue(null)

    const { ctx } = commitAt(700, 300)

    expect(mocks.resolveTarget).not.toHaveBeenCalled()
    expect(ctx.onReorderWorktrees).toHaveBeenCalled()
  })
})
