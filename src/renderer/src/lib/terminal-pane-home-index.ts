import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'
import { resolveTerminalLeafHome } from '../../../shared/terminal-pane-home'
import { collectRuntimePaneLeafIds } from './runtime-pane-title-leaf-id'

type TabsByWorktree = Record<string, readonly Pick<TerminalTab, 'id'>[]>
type LayoutsByTabId = Record<string, TerminalLayoutSnapshot>

export type TerminalPaneHomeIndex = {
  /** Foreign panes only: `${tabId}:${leafId}` to the workspace the pane belongs to. */
  homeWorktreeIdByPaneKey: ReadonlyMap<string, string>
  /** Foreign leaf ids per host tab; absent for tabs that hold only native panes. */
  foreignLeafIdsByTabId: ReadonlyMap<string, ReadonlySet<string>>
  /** The workspace whose tab list holds each tab; navigation always targets this one. */
  hostWorktreeIdByTabId: ReadonlyMap<string, string>
}

const NO_TABS: TabsByWorktree = {}
const NO_LAYOUTS: LayoutsByTabId = {}

const homedLayoutsBySource = new WeakMap<LayoutsByTabId, LayoutsByTabId>()
let lastHomedLayouts: LayoutsByTabId = NO_LAYOUTS

function sameLayoutEntries(a: LayoutsByTabId, b: LayoutsByTabId): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/** The layouts that carry home entries, reference-stable until one of them changes.
 *  Why: subscribers can select this instead of every layout, so layout churn in tabs with
 *  only native panes does not re-render status readers. */
export function selectHomedTerminalLayouts(
  layoutsByTabId: LayoutsByTabId | null | undefined
): LayoutsByTabId {
  if (!layoutsByTabId) {
    return NO_LAYOUTS
  }
  const memoized = homedLayoutsBySource.get(layoutsByTabId)
  if (memoized) {
    return memoized
  }
  const homed: LayoutsByTabId = {}
  for (const [tabId, layout] of Object.entries(layoutsByTabId)) {
    if (layout.homeByLeafId && Object.keys(layout.homeByLeafId).length > 0) {
      homed[tabId] = layout
    }
  }
  const selected = sameLayoutEntries(homed, lastHomedLayouts)
    ? lastHomedLayouts
    : Object.keys(homed).length > 0
      ? homed
      : NO_LAYOUTS
  lastHomedLayouts = selected
  homedLayoutsBySource.set(layoutsByTabId, selected)
  return selected
}

let cache: {
  tabsByWorktree: TabsByWorktree
  layoutsByTabId: LayoutsByTabId
  index: TerminalPaneHomeIndex
} | null = null

// Why: status readers run per store snapshot and per sidebar row; memoizing by
// reference keeps the tab/layout walk to once per change.
export function buildTerminalPaneHomeIndex(
  tabsByWorktree: TabsByWorktree | null | undefined,
  layoutsByTabId: LayoutsByTabId | null | undefined
): TerminalPaneHomeIndex {
  tabsByWorktree ??= NO_TABS
  layoutsByTabId = selectHomedTerminalLayouts(layoutsByTabId)
  if (cache?.tabsByWorktree === tabsByWorktree && cache.layoutsByTabId === layoutsByTabId) {
    return cache.index
  }
  const hostWorktreeIdByTabId = new Map<string, string>()
  const homeWorktreeIdByPaneKey = new Map<string, string>()
  const foreignLeafIdsByTabId = new Map<string, Set<string>>()
  for (const [hostWorktreeId, tabs] of Object.entries(tabsByWorktree)) {
    for (const tab of tabs) {
      hostWorktreeIdByTabId.set(tab.id, hostWorktreeId)
      const layout = layoutsByTabId[tab.id]
      // Why: a home entry outliving its leaf names no mounted pane; only leaves in the tree count.
      const rootLeafIds = new Set(layout ? collectRuntimePaneLeafIds(layout.root) : [])
      for (const leafId of Object.keys(layout?.homeByLeafId ?? {})) {
        const home = resolveTerminalLeafHome(layout, hostWorktreeId, leafId)
        if (!home || !rootLeafIds.has(leafId)) {
          continue
        }
        homeWorktreeIdByPaneKey.set(`${tab.id}:${leafId}`, home.worktreeId)
        const leafIds = foreignLeafIdsByTabId.get(tab.id) ?? new Set<string>()
        leafIds.add(leafId)
        foreignLeafIdsByTabId.set(tab.id, leafIds)
      }
    }
  }
  const index: TerminalPaneHomeIndex = {
    homeWorktreeIdByPaneKey,
    foreignLeafIdsByTabId,
    hostWorktreeIdByTabId
  }
  cache = { tabsByWorktree, layoutsByTabId, index }
  return index
}

/** The workspace to navigate to for a pane: a foreign pane's host tab, else the requested one. */
export function resolvePaneNavigationWorktreeId(
  index: TerminalPaneHomeIndex,
  tabId: string,
  leafId: string | null | undefined,
  requestedWorktreeId: string
): string {
  const isForeign = leafId ? index.homeWorktreeIdByPaneKey.has(`${tabId}:${leafId}`) : false
  return (isForeign ? index.hostWorktreeIdByTabId.get(tabId) : undefined) ?? requestedWorktreeId
}
