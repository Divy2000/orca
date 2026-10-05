import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { makePaneKey } from '../../shared/stable-pane-id'
import { resolveTerminalLeafHomeWorktreeId } from '../../shared/terminal-pane-home'
import { terminalLayoutContainsLeaf } from './headless-terminal-split-layout'

type PersistedLeafPtyOwner = { ptyId: string; worktreeId: string; tabId: string; leafId: string }

/**
 * The owner of each persisted leaf PTY record, shared by the worktree and surface indexes so they
 * agree on which pane holds a PTY and whose it is.
 */
function resolvePersistedLeafPtyOwners(session: WorkspaceSessionState | null | undefined): {
  owners: PersistedLeafPtyOwner[]
  mountedPtyIds: ReadonlySet<string>
} {
  const leafRecords = Object.entries(session?.tabsByWorktree ?? {}).flatMap(([worktreeId, tabs]) =>
    tabs.flatMap((tab) => {
      const layout = session?.terminalLayoutsByTabId[tab.id]
      return Object.entries(layout?.ptyIdsByLeafId ?? {}).flatMap(([leafId, ptyId]) => {
        if (!ptyId) {
          return []
        }
        const mounted = terminalLayoutContainsLeaf(layout?.root, leafId)
        return [
          {
            mounted,
            owner: {
              ptyId,
              // Why: an off-tree home attests nothing, so an off-tree record keeps its tab's worktree.
              worktreeId: mounted
                ? resolveTerminalLeafHomeWorktreeId(layout, worktreeId, leafId)
                : worktreeId,
              tabId: tab.id,
              leafId
            }
          }
        ]
      })
    })
  )
  // Why mounted leaves win session-wide: they own their PTY wherever they are, so a stale record
  // in another tab cannot dispute them. Off-tree records only cover PTYs no mounted leaf names.
  const mountedPtyIds = new Set(
    leafRecords.filter((record) => record.mounted).map((record) => record.owner.ptyId)
  )
  return {
    owners: leafRecords
      .filter((record) => record.mounted || !mountedPtyIds.has(record.owner.ptyId))
      .map((record) => record.owner),
    mountedPtyIds
  }
}

export function indexPersistedPtyWorktreeBindings(
  session: WorkspaceSessionState | null | undefined
): ReadonlyMap<string, string> {
  const worktreeIdByPtyId = new Map<string, string>()
  const ambiguousPtyIds = new Set<string>()
  const bind = (ptyId: string | null | undefined, worktreeId: string): void => {
    if (!ptyId || ambiguousPtyIds.has(ptyId)) {
      return
    }
    const existingWorktreeId = worktreeIdByPtyId.get(ptyId)
    if (existingWorktreeId && existingWorktreeId !== worktreeId) {
      // Why: a corrupt/stale duplicate binding must not attribute a live PTY to whichever workspace was visited first.
      worktreeIdByPtyId.delete(ptyId)
      ambiguousPtyIds.add(ptyId)
      return
    }
    worktreeIdByPtyId.set(ptyId, worktreeId)
  }

  const { owners, mountedPtyIds } = resolvePersistedLeafPtyOwners(session)
  for (const { ptyId, worktreeId } of owners) {
    bind(ptyId, worktreeId)
  }
  // Why: the tab-level ids are coarser than any leaf record, so they only cover PTYs no mounted leaf names.
  for (const [worktreeId, tabs] of Object.entries(session?.tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      for (const ptyId of [tab.ptyId, session?.remoteSessionIdsByTabId?.[tab.id]]) {
        if (ptyId && !mountedPtyIds.has(ptyId)) {
          bind(ptyId, worktreeId)
        }
      }
    }
  }
  return worktreeIdByPtyId
}

export function indexPersistedPtySurfaceBindings(
  session: WorkspaceSessionState | null | undefined
): ReadonlyMap<
  string,
  { worktreeId: string; tabId: string; paneKey: string; incarnationId: string }
> {
  const bindingByPtyId = new Map<
    string,
    { worktreeId: string; tabId: string; paneKey: string; incarnationId: string }
  >()
  const ambiguousPtyIds = new Set<string>()
  for (const { ptyId, worktreeId, tabId, leafId } of resolvePersistedLeafPtyOwners(session)
    .owners) {
    if (ambiguousPtyIds.has(ptyId)) {
      continue
    }
    const paneKey = makePaneKey(tabId, leafId)
    const incarnationId = session?.terminalPtyIncarnationsByPaneKey?.[paneKey]
    if (!incarnationId) {
      continue
    }
    const existing = bindingByPtyId.get(ptyId)
    if (
      existing &&
      (existing.worktreeId !== worktreeId ||
        existing.paneKey !== paneKey ||
        existing.incarnationId !== incarnationId)
    ) {
      bindingByPtyId.delete(ptyId)
      ambiguousPtyIds.add(ptyId)
      continue
    }
    bindingByPtyId.set(ptyId, { worktreeId, tabId, paneKey, incarnationId })
  }
  return bindingByPtyId
}

export function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false
    }
  }
  return true
}
