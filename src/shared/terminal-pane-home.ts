import type {
  TerminalLayoutSnapshot,
  TerminalLeafHome,
  TerminalPaneLayoutNode
} from './terminal-tab-types'

type LayoutWithHomes = Pick<TerminalLayoutSnapshot, 'homeByLeafId'>

/** The leaf's foreign home, or null when it is native to `ownerWorktreeId`. */
export function resolveTerminalLeafHome(
  layout: LayoutWithHomes | null | undefined,
  ownerWorktreeId: string,
  leafId: string
): TerminalLeafHome | null {
  const home = layout?.homeByLeafId?.[leafId]
  return home && home.worktreeId !== ownerWorktreeId ? home : null
}

export function resolveTerminalLeafHomeWorktreeId(
  layout: LayoutWithHomes | null | undefined,
  ownerWorktreeId: string,
  leafId: string
): string {
  return resolveTerminalLeafHome(layout, ownerWorktreeId, leafId)?.worktreeId ?? ownerWorktreeId
}

function collectRootLeafIds(root: TerminalPaneLayoutNode | null): Set<string> {
  const leafIds = new Set<string>()
  const pending = root ? [root] : []
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (node.type === 'leaf') {
      leafIds.add(node.leafId)
    } else {
      pending.push(node.first, node.second)
    }
  }
  return leafIds
}

/** Drops entries for missing leaves, owner-native homes, and (when supplied) unknown workspaces.
 *  Why: a pane whose home workspace was deleted falls back to native instead of killing its process. */
export function normalizeTerminalLeafHomes(
  layout: TerminalLayoutSnapshot,
  ownerWorktreeId: string,
  validWorktreeIds?: ReadonlySet<string>
): TerminalLayoutSnapshot {
  const { homeByLeafId, ...rest } = layout
  if (!homeByLeafId) {
    return layout
  }
  const rootLeafIds = collectRootLeafIds(layout.root)
  const retained = Object.entries(homeByLeafId).filter(
    ([leafId, home]) =>
      rootLeafIds.has(leafId) &&
      home.worktreeId !== ownerWorktreeId &&
      (!validWorktreeIds || validWorktreeIds.has(home.worktreeId))
  )
  if (retained.length === Object.keys(homeByLeafId).length) {
    return layout
  }
  return retained.length > 0 ? { ...rest, homeByLeafId: Object.fromEntries(retained) } : rest
}

/** Home entries to carry across a layout rebuild, limited to leaves still mounted. */
export function carryTerminalLeafHomes(
  prior: Record<string, TerminalLeafHome> | undefined,
  currentLeafIds: ReadonlySet<string>
): Record<string, TerminalLeafHome> | undefined {
  const carried = Object.entries(prior ?? {}).filter(([leafId]) => currentLeafIds.has(leafId))
  return carried.length > 0 ? Object.fromEntries(carried) : undefined
}

function sameTerminalLeafHome(a: TerminalLeafHome, b: TerminalLeafHome): boolean {
  return (
    a.worktreeId === b.worktreeId &&
    a.sessionTabId === b.sessionTabId &&
    a.sessionLeafId === b.sessionLeafId &&
    a.slot?.groupId === b.slot?.groupId &&
    a.slot?.afterTabId === b.slot?.afterTabId &&
    a.color === b.color &&
    a.isPinned === b.isPinned
  )
}

export function sameTerminalLeafHomes(
  a: Readonly<Record<string, TerminalLeafHome>> | undefined,
  b: Readonly<Record<string, TerminalLeafHome>> | undefined
): boolean {
  const left = a ?? {}
  const right = b ?? {}
  const leftKeys = Object.keys(left)
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every(
      (key) => Object.hasOwn(right, key) && sameTerminalLeafHome(left[key]!, right[key]!)
    )
  )
}
