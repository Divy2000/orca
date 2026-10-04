import type { AppState } from '@/store/types'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { isRemoteRuntimePtyId } from '@/store/terminals/terminal-pty-identities'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { isLocalTerminalWorkspace } from './terminal-pane-home-validity'
import {
  resolveTerminalPaneMoveSurface,
  type TerminalPaneMoveSurface
} from './terminal-pane-move-surface'

export type TerminalPaneMoveRejection =
  | 'pane-missing'
  | 'same-tab'
  | 'different-host'
  | 'remote-host'
  | 'remote-terminal'
  | 'native-chat'
  | 'pane-not-ready'

export type TerminalPaneMoveCheck =
  | {
      ok: true
      source: TerminalPaneMoveSurface
      target: TerminalPaneMoveSurface
    }
  | { ok: false; reason: TerminalPaneMoveRejection }

function isHostOwnedPtyId(ptyId: string): boolean {
  return isRemoteRuntimePtyId(ptyId) || ptyId.startsWith('remote:') || !!parseAppSshPtyId(ptyId)
}

function reject(reason: TerminalPaneMoveRejection): TerminalPaneMoveCheck {
  return { ok: false, reason }
}

/** Whether a pane may join another tab's split. Moves are local-only: a PTY never changes host. */
export function canMoveTerminalPane(
  state: AppState,
  sourcePaneKey: string,
  targetPaneKey: string
): TerminalPaneMoveCheck {
  const source = resolveTerminalPaneMoveSurface(state, sourcePaneKey)
  const target = resolveTerminalPaneMoveSurface(state, targetPaneKey)
  if (!source || !target) {
    return reject('pane-missing')
  }
  if (source.tabId === target.tabId) {
    return reject('same-tab')
  }
  if (
    getExecutionHostIdForWorktree(state, source.worktreeId) !==
    getExecutionHostIdForWorktree(state, target.worktreeId)
  ) {
    return reject('different-host')
  }
  if (
    !isLocalTerminalWorkspace(state, source.worktreeId) ||
    !isLocalTerminalWorkspace(state, target.worktreeId)
  ) {
    return reject('remote-host')
  }
  // Why the live id too: a mounted target may not have persisted its transport's PTY yet.
  const targetPtyIds = [
    ...Object.values(target.layout.ptyIdsByLeafId ?? {}),
    ...(target.ptyId ? [target.ptyId] : [])
  ]
  if ((source.ptyId && isHostOwnedPtyId(source.ptyId)) || targetPtyIds.some(isHostOwnedPtyId)) {
    return reject('remote-terminal')
  }
  if (source.layout.chatLeafId === source.leafId || target.layout.chatLeafId === target.leafId) {
    return reject('native-chat')
  }
  // Why: a pane without a bound PTY would respawn in the target's cwd instead of moving.
  if (!source.ptyId || source.paneCwd?.pendingCwd) {
    return reject('pane-not-ready')
  }
  return { ok: true, source, target }
}
