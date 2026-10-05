import type { AppState } from '@/store/types'
import { getConnectionIdFromState } from '@/lib/connection-owner-resolution'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  findIndexedDetectedWorktrees,
  findIndexedFolderWorkspaceOwner
} from '@/lib/worktree-runtime-owner-index'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { resolveTerminalLeafHome } from '../../../../shared/terminal-pane-home'
import type {
  TerminalLayoutSnapshot,
  TerminalLeafHome
} from '../../../../shared/terminal-tab-types'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import type { Worktree } from '../../../../shared/worktree/types'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'

export type TerminalPaneHomeState = Pick<
  AppState,
  'folderWorkspaces' | 'worktreesByRepo' | 'detectedWorktreesByRepo' | 'repos' | 'projectGroups'
> &
  Parameters<typeof getExecutionHostIdForWorktree>[0]

/** Whether the visible catalog (folder workspaces or worktree rows) lists the workspace. */
export function isCatalogTerminalHome(state: TerminalPaneHomeState, workspaceId: string): boolean {
  const scope = parseWorkspaceKey(workspaceId)
  if (scope?.type === 'folder') {
    return findIndexedFolderWorkspaceOwner(state.folderWorkspaces, scope.folderWorkspaceId) !== null
  }
  const worktreeId = scope?.type === 'worktree' ? scope.worktreeId : workspaceId
  return findWorktreeById(state.worktreesByRepo, worktreeId) !== undefined
}

/**
 * Whether the workspace is listed, provably gone, or not known yet. Mirrors session hydration
 * (#1158): only loaded worktrees or an authoritative scan prove a worktree is gone.
 */
function resolveWorkspaceListing(
  state: TerminalPaneHomeState,
  workspaceId: string
): 'listed' | 'absent' | 'unknown' {
  const scope = parseWorkspaceKey(workspaceId)
  const worktreeId = scope?.type === 'worktree' ? scope.worktreeId : workspaceId
  if (
    isCatalogTerminalHome(state, workspaceId) ||
    findIndexedDetectedWorktrees(state.detectedWorktreesByRepo, worktreeId).length > 0
  ) {
    return 'listed'
  }
  // Why: folder workspaces are local catalog state, so a missing one is gone.
  if (scope?.type === 'folder') {
    return 'absent'
  }
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  if (!state.repos.some((repo) => repo.id === repoId)) {
    return 'absent'
  }
  const detection = state.detectedWorktreesByRepo?.[repoId]
  const loaded =
    (state.worktreesByRepo[repoId]?.length ?? 0) > 0 && detection?.authoritative !== false
  return loaded || detection?.authoritative === true ? 'absent' : 'unknown'
}

/** A home listed only by worktree detection (not yet in the visible catalog). */
export function findDetectedTerminalHomeRow(
  state: Pick<AppState, 'detectedWorktreesByRepo'>,
  worktreeId: string
): Pick<Worktree, 'displayName' | 'branch'> | null {
  for (const listing of Object.values(state.detectedWorktreesByRepo ?? {})) {
    const row = listing.worktrees.find((worktree) => worktree.id === worktreeId)
    if (row) {
      return row
    }
  }
  return null
}

export function isLocalTerminalWorkspace(
  state: TerminalPaneHomeState,
  workspaceId: string
): boolean {
  return (
    getExecutionHostIdForWorktree(state, workspaceId) === LOCAL_EXECUTION_HOST_ID &&
    getConnectionIdFromState(state, workspaceId) === null
  )
}

/** `unknown` while the home's repo is still loading: keep the home, but offer no Back yet. */
export type TerminalPaneHomeStatus = 'reachable' | 'unreachable' | 'unknown'

export function resolveTerminalPaneHomeStatus(
  state: TerminalPaneHomeState,
  hostWorktreeId: string,
  homeWorktreeId: string
): TerminalPaneHomeStatus {
  const listing = resolveWorkspaceListing(state, homeWorktreeId)
  if (
    listing === 'absent' ||
    !isLocalTerminalWorkspace(state, homeWorktreeId) ||
    !isLocalTerminalWorkspace(state, hostWorktreeId)
  ) {
    return 'unreachable'
  }
  return listing === 'listed' ? 'reachable' : 'unknown'
}

/** The leaf's foreign home unless it is definitively unreachable; a stale home reads as native. */
export function resolveRetainedTerminalLeafHome(
  state: TerminalPaneHomeState,
  layout: TerminalLayoutSnapshot | null | undefined,
  hostWorktreeId: string,
  leafId: string
): TerminalLeafHome | null {
  const home = resolveTerminalLeafHome(layout, hostWorktreeId, leafId)
  return home &&
    resolveTerminalPaneHomeStatus(state, hostWorktreeId, home.worktreeId) !== 'unreachable'
    ? home
    : null
}
