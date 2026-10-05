import { useMemo } from 'react'
import { sortWorktreesSmart } from '@/components/sidebar/smart-sort'
import type { Worktree } from '../../../shared/worktree/types'
import { EMPTY_SORTED_WORKTREES } from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteWorktreesInput } from './worktree-jump-palette-worktrees-input'

type PaletteBrowserSortInput = Pick<
  WorktreeJumpPaletteWorktreesInput,
  | 'paletteStatusInputsActive'
  | 'allWorktrees'
  | 'filterPredicate'
  | 'tabsByWorktree'
  | 'repoMap'
  | 'agentStatusByPaneKey'
  | 'runtimePaneTitlesByTabId'
  | 'runtimePaneTitleLeafIdsByTabId'
  | 'ptyIdsByTabId'
  | 'migrationUnsupportedByPtyId'
  | 'terminalLayoutsByTabId'
>

/** The palette's smart-sorted worktrees while its status inputs are live. */
export function usePaletteBrowserSortedWorktrees(input: PaletteBrowserSortInput): Worktree[] {
  const {
    paletteStatusInputsActive,
    allWorktrees,
    filterPredicate,
    tabsByWorktree,
    repoMap,
    agentStatusByPaneKey,
    runtimePaneTitlesByTabId,
    runtimePaneTitleLeafIdsByTabId,
    ptyIdsByTabId,
    migrationUnsupportedByPtyId,
    terminalLayoutsByTabId
  } = input
  return useMemo(() => {
    if (!paletteStatusInputsActive) {
      return EMPTY_SORTED_WORKTREES
    }
    const scope = filterPredicate
      ? allWorktrees.filter(filterPredicate.matchesWorktree)
      : allWorktrees
    return sortWorktreesSmart(
      scope,
      tabsByWorktree,
      repoMap,
      agentStatusByPaneKey,
      runtimePaneTitlesByTabId,
      ptyIdsByTabId,
      migrationUnsupportedByPtyId,
      terminalLayoutsByTabId,
      runtimePaneTitleLeafIdsByTabId
    )
  }, [
    paletteStatusInputsActive,
    allWorktrees,
    filterPredicate,
    tabsByWorktree,
    repoMap,
    agentStatusByPaneKey,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    migrationUnsupportedByPtyId,
    terminalLayoutsByTabId,
    runtimePaneTitleLeafIdsByTabId
  ])
}
