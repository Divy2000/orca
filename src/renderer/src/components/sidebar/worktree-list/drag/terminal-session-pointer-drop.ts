import { useAppStore } from '@/store'
import type { TerminalSessionDragPayload } from '@/lib/terminal-session-drag-data'
import { resolveWorkspaceTerminalSessionDrag } from '@/components/terminal-pane/terminal-session-drop'
import type { WorktreePointerDrag } from './row-state'

/** The terminal a single dragged workspace card stands for; multi-card drags carry none. */
export function resolveWorktreePointerTerminalSessionDrag(
  drag: Pick<WorktreePointerDrag, 'worktreeId' | 'draggedIds'>
): TerminalSessionDragPayload | null {
  return drag.draggedIds.length === 1
    ? resolveWorkspaceTerminalSessionDrag(useAppStore.getState(), drag.worktreeId)
    : null
}
