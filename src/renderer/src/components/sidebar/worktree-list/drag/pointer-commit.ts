import {
  getWorkspaceKanbanSidebarDropGroups,
  getWorkspaceKanbanSidebarDropTarget,
  isWorkspaceKanbanSidebarDropPointInBoard,
  resolveWorkspaceKanbanSidebarFullLaneDropIndex
} from '../../workspace-kanban-sidebar-drop'
import { resolveWorkspaceKanbanCardDropCommitTarget } from '../../workspace-kanban-card-pointer-drag-dom'
import { getFullDropIndexForWorktreeDragUnit } from '../../worktree-drag-units'
import { resolveWorktreeSidebarStatusDropCommitTarget } from '../../worktree-sidebar-drop-preview'
import { getPointerDropStatusTarget, shouldPreferSidebarStatusDropTarget } from './status-target'
import type {
  WorktreeDropCommitContext,
  WorktreeStatusDropAtIndexArgs
} from './drop-commit-context'
import type { WorktreeSidebarStatusDropTarget } from '../../worktree-sidebar-drop-preview'
import { NO_WORKTREE_SIDEBAR_DROP_TARGET, type WorktreePointerDrag } from './row-state'
import {
  commitTerminalSessionDrop,
  resolveTerminalSessionDropTarget
} from '@/components/terminal-pane/terminal-session-drop'
import { resolveWorktreePointerTerminalSessionDrag } from './terminal-session-pointer-drop'

type PointerDropCommitArgs = {
  event: PointerEvent
  drag: WorktreePointerDrag
  ctx: WorktreeDropCommitContext
  onWorkspaceBoardDragPreviewCommit: () => void
  onDropWorktreesOnWorkspaceBoard: (args: WorktreeStatusDropAtIndexArgs) => void
}

function commitStatusOrPinDrop(
  args: PointerDropCommitArgs,
  target: WorktreeSidebarStatusDropTarget & { lineageParentId?: string | null },
  dropIndex: number | null
): void {
  const { drag, ctx } = args
  if (target.isPinDrop) {
    ctx.onPinWorktrees(drag.draggedIds)
    return
  }
  if (!target.status) {
    return
  }
  if (dropIndex === null) {
    ctx.onMoveWorktreesToStatus(drag.reorderDraggedIds, target.status)
    return
  }
  ctx.onMoveWorktreesToStatusAtIndex({
    worktreeIds: drag.reorderDraggedIds,
    status: target.status,
    dropIndex,
    groups: ctx.worktreeDragGroups
  })
}

/** Joins the dragged workspace's terminal into the pane split under the release. True when a pane
 *  was under the pointer, even if the move was refused: its toast explains, and the sidebar must not
 *  reorder from a release that was never over it. */
function commitTerminalPaneDrop(args: PointerDropCommitArgs): boolean {
  const payload = resolveWorktreePointerTerminalSessionDrag(args.drag)
  const target = payload
    ? resolveTerminalSessionDropTarget(args.event.clientX, args.event.clientY, payload)
    : null
  if (!payload || !target) {
    return false
  }
  commitTerminalSessionDrop(payload, target)
  return true
}

// Resolve where a released pointer drag lands: workspace board lane, terminal pane, lineage
// parent, status/pin section, or a reorder slot inside the source group.
export function commitWorktreePointerDrop(args: PointerDropCommitArgs): void {
  const { event, drag, ctx } = args
  if (!ctx.refreshWorktreeDragSession()) {
    ctx.clearWorktreeDrag()
    return
  }
  const boardDropTarget = resolveWorkspaceKanbanCardDropCommitTarget({
    currentTarget: getWorkspaceKanbanSidebarDropTarget(event.clientX, event.clientY),
    latestTrackedTarget: drag.latestBoardDropTarget,
    x: event.clientX,
    y: event.clientY
  })
  if (isWorkspaceKanbanSidebarDropPointInBoard(event.clientX, event.clientY)) {
    args.onWorkspaceBoardDragPreviewCommit()
  }
  if (boardDropTarget.isPinDrop) {
    ctx.onPinWorktrees(drag.draggedIds)
  } else if (boardDropTarget.status) {
    args.onDropWorktreesOnWorkspaceBoard({
      worktreeIds: drag.reorderDraggedIds,
      status: boardDropTarget.status,
      // Why: the target counts rendered cards, but the groups are the full
      // lane. Board search can make those two differ.
      dropIndex: resolveWorkspaceKanbanSidebarFullLaneDropIndex(
        boardDropTarget.status,
        boardDropTarget.dropIndex
      ),
      groups: getWorkspaceKanbanSidebarDropGroups()
    })
  } else if (!commitTerminalPaneDrop(args)) {
    const preferredStatusTarget = ctx.getEligibleLineageDropTarget(
      ctx.scrollRef.current
        ? getPointerDropStatusTarget({
            container: ctx.scrollRef.current,
            x: event.clientX,
            y: event.clientY
          })
        : NO_WORKTREE_SIDEBAR_DROP_TARGET,
      drag.draggedIds
    )
    if (preferredStatusTarget.lineageParentId) {
      ctx.commitWorktreeLineageParentDrop(drag.draggedIds, preferredStatusTarget.lineageParentId)
      ctx.clearWorktreeDrag()
      return
    }
    if (
      shouldPreferSidebarStatusDropTarget({
        sourceGroupKey: drag.sourceGroupKey,
        target: preferredStatusTarget,
        workspaceStatuses: ctx.workspaceStatuses
      })
    ) {
      const statusDrop = preferredStatusTarget.status
        ? ctx.computeWorktreeStatusDrop({
            pointerY: event.clientY,
            status: preferredStatusTarget.status,
            draggedIds: drag.reorderDraggedIds
          })
        : null
      commitStatusOrPinDrop(args, preferredStatusTarget, statusDrop?.dropIndex ?? null)
      ctx.clearWorktreeDrag()
      return
    }
    const drop = ctx.computeWorktreeDrop(event.clientY)
    if (drop) {
      ctx.onReorderWorktrees({
        groups: ctx.worktreeDragGroups,
        sourceGroupKey: drag.sourceGroupKey,
        draggedIds: drag.reorderDraggedIds,
        dropIndex: getFullDropIndexForWorktreeDragUnit({
          groups: ctx.worktreeDragUnitGroups,
          sourceGroupKey: drag.sourceGroupKey,
          dropIndex: drop.dropIndex
        })
      })
      ctx.clearReorderedWorktreeParents({
        draggedIds: drag.draggedIds,
        sourceGroupKey: drag.sourceGroupKey
      })
    } else if (ctx.scrollRef.current) {
      const currentPreview = preferredStatusTarget.status
        ? ctx.computeWorktreeStatusDrop({
            pointerY: event.clientY,
            status: preferredStatusTarget.status,
            draggedIds: drag.reorderDraggedIds
          })
        : null
      const { target, preview: statusDrop } = resolveWorktreeSidebarStatusDropCommitTarget({
        currentTarget: preferredStatusTarget,
        currentPreview,
        latestTrackedTarget: drag.latestStatusDropTarget,
        x: event.clientX,
        y: event.clientY
      })
      if (target.lineageParentId) {
        ctx.commitWorktreeLineageParentDrop(drag.draggedIds, target.lineageParentId)
      } else {
        commitStatusOrPinDrop(args, target, statusDrop?.dropIndex ?? null)
      }
    }
  }
  ctx.clearWorktreeDrag()
}
