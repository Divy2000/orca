import type { AppState } from '@/store'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { PaneCwdEntry } from './resolve-split-cwd'
import {
  detachLastTerminalLayoutLeaf,
  detachTerminalLayoutLeaf
} from './terminal-layout-leaf-detach'
import { normalizeTerminalLeafHomes } from '../../../../shared/terminal-pane-home'
export {
  isTerminalTabStripDropTarget,
  resolveTerminalTabStripDropTarget
} from './terminal-tab-strip-drop-target'
export type { TerminalTabStripDropTarget } from './terminal-tab-strip-drop-target'

export type TerminalPaneTabDetachStore = Pick<
  AppState,
  | 'closeTab'
  | 'createTab'
  | 'groupsByWorktree'
  | 'reorderUnifiedTabs'
  | 'setActiveTab'
  | 'setActiveTabType'
  | 'setTabLayout'
  | 'syncPaneDetachPtyOwnership'
  | 'tabsByWorktree'
  | 'terminalLayoutsByTabId'
>

type TerminalPaneTabDetachManager = {
  getPanes: () => readonly { id: number }[]
  getLeafId: (paneId: number) => string | null
  detachPaneForExternalMove: (paneId: number) => boolean
}

type SourcePaneCwd = Pick<PaneCwdEntry, 'cwd' | 'deferredSplitSpawn' | 'pendingCwd'> &
  Partial<Pick<PaneCwdEntry, 'confirmed'>>

export type DetachedTerminalPaneTab = {
  tab: TerminalTab
  leafId: string
  ptyId: string | null
}

function withDetachedPtyFallback(args: {
  leafId: string
  ptyId: string | null
  detachedLayout: NonNullable<ReturnType<typeof detachTerminalLayoutLeaf>>['detachedLayout']
}): NonNullable<ReturnType<typeof detachTerminalLayoutLeaf>>['detachedLayout'] {
  if (!args.ptyId || args.detachedLayout.ptyIdsByLeafId?.[args.leafId]) {
    return args.detachedLayout
  }
  return {
    ...args.detachedLayout,
    ptyIdsByLeafId: {
      ...args.detachedLayout.ptyIdsByLeafId,
      [args.leafId]: args.ptyId
    }
  }
}

function moveCreatedTabToIndex(args: {
  groupId: string
  store: TerminalPaneTabDetachStore
  tabId: string
  targetIndex: number | undefined
  worktreeId: string
}): void {
  if (args.targetIndex === undefined) {
    return
  }
  const group = args.store.groupsByWorktree[args.worktreeId]?.find(
    (candidate) => candidate.id === args.groupId
  )
  if (!group) {
    return
  }
  const orderWithoutCreatedTab = (group.tabOrder ?? []).filter((id) => id !== args.tabId)
  const insertionIndex = Math.min(Math.max(args.targetIndex, 0), orderWithoutCreatedTab.length)
  const nextOrder = [...orderWithoutCreatedTab]
  nextOrder.splice(insertionIndex, 0, args.tabId)
  args.store.reorderUnifiedTabs(args.groupId, nextOrder, { recordInteraction: false })
}

export function detachTerminalPaneToTab(args: {
  fallbackPtyId?: string | null
  getStore: () => TerminalPaneTabDetachStore
  manager: TerminalPaneTabDetachManager | null
  persistLayoutSnapshot: () => void
  sourcePaneId: number
  sourcePaneCwd?: SourcePaneCwd
  sourceTabId: string
  /** Omitted: the new tab joins the target workspace's active group. */
  targetGroupId?: string
  targetIndex?: number
  worktreeId: string
  /** Workspace that receives the new tab; defaults to the source tab's own. */
  targetWorktreeId?: string
  activate?: boolean
  /** Moves a tab's only pane too; the emptied source tab then closes without killing the PTY. */
  allowLastPane?: boolean
}): DetachedTerminalPaneTab | null {
  const targetWorktreeId = args.targetWorktreeId ?? args.worktreeId
  const activate = args.activate !== false
  const initialStore = args.getStore()
  const targetGroups = initialStore.groupsByWorktree[targetWorktreeId] ?? []
  const targetGroupExists =
    args.targetGroupId === undefined ||
    targetGroups.some((group) => group.id === args.targetGroupId)
  const detachesLastPane = (args.manager?.getPanes().length ?? 0) <= 1
  if (!args.manager || !targetGroupExists || (detachesLastPane && !args.allowLastPane)) {
    return null
  }

  const sourceLeafId = args.manager.getLeafId(args.sourcePaneId)
  if (!sourceLeafId) {
    return null
  }

  const persistedPtyId =
    initialStore.terminalLayoutsByTabId[args.sourceTabId]?.ptyIdsByLeafId?.[sourceLeafId]
  const cwdDeferred = Boolean(
    args.sourcePaneCwd?.pendingCwd || args.sourcePaneCwd?.deferredSplitSpawn
  )
  if (cwdDeferred && !persistedPtyId && !args.fallbackPtyId) {
    return null
  }

  args.persistLayoutSnapshot()
  const store = args.getStore()
  const sourceLayout = store.terminalLayoutsByTabId[args.sourceTabId]
  const detached = detachesLastPane
    ? detachLastTerminalLayoutLeaf(sourceLayout, sourceLeafId)
    : detachTerminalLayoutLeaf(sourceLayout, sourceLeafId)
  if (!detached) {
    return null
  }

  const ptyId = detached.ptyId ?? args.fallbackPtyId ?? null
  // Why: a pane landing in a tab of its own home workspace is native there again.
  const detachedLayout = normalizeTerminalLeafHomes(
    withDetachedPtyFallback({
      leafId: sourceLeafId,
      ptyId,
      detachedLayout: detached.detachedLayout
    }),
    targetWorktreeId
  )

  // Why: remove the renderer pane only after the layout/PTY handoff has been
  // computed; the close callback detaches listeners but must not kill the PTY.
  // A last pane stays mounted until its tab closes, which detaches (never kills) it.
  if (!detachesLastPane && !args.manager.detachPaneForExternalMove(args.sourcePaneId)) {
    return null
  }

  const latestStore = args.getStore()
  const sourceShellOverride = latestStore.tabsByWorktree[args.worktreeId]?.find(
    (candidate) => candidate.id === args.sourceTabId
  )?.shellOverride
  const tab = latestStore.createTab(targetWorktreeId, args.targetGroupId, sourceShellOverride, {
    activate,
    ...(detachedLayout.chatLeafId ? { viewMode: 'chat' as const } : {}),
    initialPtyId: ptyId ?? undefined,
    ...(!ptyId
      ? {
          pendingActivationSpawn: true,
          ...(args.sourcePaneCwd?.cwd ? { startupCwd: args.sourcePaneCwd.cwd } : {})
        }
      : {}),
    recordInteraction: activate
  })
  const afterCreateStore = args.getStore()
  if (args.targetGroupId !== undefined) {
    moveCreatedTabToIndex({
      groupId: args.targetGroupId,
      store: afterCreateStore,
      tabId: tab.id,
      targetIndex: args.targetIndex,
      worktreeId: targetWorktreeId
    })
  }
  if (!detachesLastPane) {
    afterCreateStore.setTabLayout(args.sourceTabId, detached.sourceLayout)
  }
  afterCreateStore.setTabLayout(tab.id, detachedLayout)
  afterCreateStore.syncPaneDetachPtyOwnership({
    detachedLeafId: sourceLeafId,
    detachedPtyId: ptyId,
    sourceLayout: detached.sourceLayout,
    sourceTabId: args.sourceTabId,
    targetTabId: tab.id
  })
  if (detachesLastPane) {
    // Why 'cleanup': the new tab owns the PTY, so retirement treats it as shared; 'pty-exit' would leave main's membership behind.
    afterCreateStore.closeTab(args.sourceTabId, { reason: 'cleanup', captureRecentlyClosed: false })
  }
  if (activate) {
    afterCreateStore.setActiveTab(tab.id)
    afterCreateStore.setActiveTabType('terminal', targetWorktreeId)
  }

  return { tab, leafId: sourceLeafId, ptyId }
}
