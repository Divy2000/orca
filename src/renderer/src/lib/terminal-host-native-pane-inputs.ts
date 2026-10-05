import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode
} from '../../../shared/terminal-tab-types'
import { resolveTerminalLeafHome } from '../../../shared/terminal-pane-home'
import { FIRST_PANE_ID } from '../../../shared/pane-key'
import { isTerminalLeafId } from '../../../shared/stable-pane-id'
import {
  collectRuntimePaneLeafIds,
  resolveRuntimePaneTitleSlotLeafId
} from './runtime-pane-title-leaf-id'
import type { TerminalPaneHomeIndex } from './terminal-pane-home-index'

// Why: a workspace's status reads only the panes it owns. These strip panes a host only
// hosts from its tab-keyed inputs (returning the input itself when none apply) and project
// those panes into their home's inputs instead.

type LayoutsByTabId =
  | Readonly<Record<string, TerminalLayoutSnapshot | undefined>>
  | null
  | undefined
type ForeignLeafIdsByTabId = ReadonlyMap<string, ReadonlySet<string>>
type RuntimePaneTitleLeafIdsByTabId = Readonly<Record<string, Record<number, string>>>

/** Foreign leaves of one workspace's own tabs; for status inputs already narrowed to that workspace. */
export function collectForeignLeafIdsByTabId(
  tabs: readonly { id: string }[],
  layoutsByTabId: LayoutsByTabId,
  ownerWorktreeId: string
): ForeignLeafIdsByTabId {
  const out = new Map<string, Set<string>>()
  for (const tab of tabs) {
    const layout = layoutsByTabId?.[tab.id]
    const rootLeafIds = new Set(layout ? collectRuntimePaneLeafIds(layout.root) : [])
    for (const leafId of Object.keys(layout?.homeByLeafId ?? {})) {
      if (rootLeafIds.has(leafId) && resolveTerminalLeafHome(layout, ownerWorktreeId, leafId)) {
        out.set(tab.id, (out.get(tab.id) ?? new Set<string>()).add(leafId))
      }
    }
  }
  return out
}

function filterPaneTitles(
  paneTitles: Record<number, string>,
  paneTitleLeafIds: Record<number, string> | undefined,
  layout: TerminalLayoutSnapshot | undefined,
  livePtyIds: readonly string[],
  leafIds: ReadonlySet<string>,
  keepListed: boolean
): [string, string][] {
  const rootLeafIds = collectRuntimePaneLeafIds(layout?.root)
  const liveSlotIds = Object.keys(paneTitles)
    .map(Number)
    .filter((paneId) => Number.isInteger(paneId) && paneId >= FIRST_PANE_ID)
    .sort((a, b) => a - b)
  const liveSlotsAreDense =
    liveSlotIds.length === rootLeafIds.length &&
    liveSlotIds.every((paneId, index) => paneId === FIRST_PANE_ID + index)
  // Why: in a tab hosting foreign panes, a title no slot or PTY binding places may be foreign,
  // so it is credited to nobody rather than to the host.
  return Object.entries(paneTitles).filter(([runtimePaneId]) => {
    const leafId = isTerminalLeafId(runtimePaneId)
      ? runtimePaneId
      : resolveRuntimePaneTitleSlotLeafId({
          layout,
          leafIds: rootLeafIds,
          ptyIds: [...livePtyIds],
          liveSlotIds,
          liveSlotsAreDense,
          paneId: Number(runtimePaneId),
          paneTitleLeafIds
        })
    return leafId !== null && leafIds.has(leafId) === keepListed
  })
}

function filterPtyIds(
  ptyIds: readonly string[],
  layout: TerminalLayoutSnapshot | undefined,
  leafIds: ReadonlySet<string>,
  keepListed: boolean
): string[] {
  // Why: in a tab hosting foreign panes, a PTY no leaf binding names yet (hydration) may be
  // foreign, so it is credited to nobody rather than to the host.
  const keptPtyIds = new Set(
    Object.entries(layout?.ptyIdsByLeafId ?? {})
      .filter(([leafId]) => leafIds.has(leafId) === keepListed)
      .map(([, ptyId]) => ptyId)
  )
  return ptyIds.filter((ptyId) => keptPtyIds.has(ptyId))
}

function withTabRecord<T>(
  record: Record<string, T>,
  source: Record<string, T>,
  tabId: string,
  value: T | null
): Record<string, T> {
  const out = record === source ? { ...record } : record
  if (value === null) {
    delete out[tabId]
  } else {
    out[tabId] = value
  }
  return out
}

export function omitForeignPaneTitles(
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>,
  layoutsByTabId: LayoutsByTabId,
  foreignLeafIdsByTabId: ForeignLeafIdsByTabId,
  ptyIdsByTabId: Record<string, string[]>,
  runtimePaneTitleLeafIdsByTabId: RuntimePaneTitleLeafIdsByTabId
): Record<string, Record<number, string>> {
  let out = runtimePaneTitlesByTabId
  for (const [tabId, foreignLeafIds] of foreignLeafIdsByTabId) {
    const paneTitles = runtimePaneTitlesByTabId[tabId]
    if (!paneTitles) {
      continue
    }
    const kept = filterPaneTitles(
      paneTitles,
      runtimePaneTitleLeafIdsByTabId[tabId],
      layoutsByTabId?.[tabId],
      ptyIdsByTabId[tabId] ?? [],
      foreignLeafIds,
      false
    )
    if (kept.length !== Object.keys(paneTitles).length) {
      const value = kept.length > 0 ? Object.fromEntries(kept) : null
      out = withTabRecord(out, runtimePaneTitlesByTabId, tabId, value)
    }
  }
  return out
}

export function omitForeignPanePtyIds(
  ptyIdsByTabId: Record<string, string[]>,
  layoutsByTabId: LayoutsByTabId,
  foreignLeafIdsByTabId: ForeignLeafIdsByTabId
): Record<string, string[]> {
  let out = ptyIdsByTabId
  for (const [tabId, foreignLeafIds] of foreignLeafIdsByTabId) {
    const ptyIds = ptyIdsByTabId[tabId]
    if (!ptyIds) {
      continue
    }
    const kept = filterPtyIds(ptyIds, layoutsByTabId?.[tabId], foreignLeafIds, false)
    if (kept.length !== ptyIds.length) {
      out = withTabRecord(out, ptyIdsByTabId, tabId, kept.length > 0 ? kept : null)
    }
  }
  return out
}

export type HomedPaneStatusInputs = {
  /** Host tabs carrying this home's panes; untitled so a host tab title never speaks for them. */
  tabs: { id: string; title: string }[]
  ptyIdsByTabId: Record<string, string[]>
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>
  terminalLayoutRootsByTabId: Record<string, TerminalPaneLayoutNode | null | undefined>
}

/** The panes `homeWorktreeId` owns inside other workspaces' tabs, shaped as that home's inputs. */
export function collectHomedPaneStatusInputs(
  index: Pick<TerminalPaneHomeIndex, 'foreignLeafIdsByTabId' | 'homeWorktreeIdByPaneKey'>,
  homeWorktreeId: string,
  layoutsByTabId: LayoutsByTabId,
  ptyIdsByTabId: Record<string, string[]>,
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>,
  runtimePaneTitleLeafIdsByTabId: RuntimePaneTitleLeafIdsByTabId
): HomedPaneStatusInputs | null {
  const out: HomedPaneStatusInputs = {
    tabs: [],
    ptyIdsByTabId: {},
    runtimePaneTitlesByTabId: {},
    terminalLayoutRootsByTabId: {}
  }
  for (const [tabId, foreignLeafIds] of index.foreignLeafIdsByTabId) {
    const homedLeafIds = new Set(
      [...foreignLeafIds].filter(
        (leafId) => index.homeWorktreeIdByPaneKey.get(`${tabId}:${leafId}`) === homeWorktreeId
      )
    )
    if (homedLeafIds.size === 0) {
      continue
    }
    const layout = layoutsByTabId?.[tabId]
    out.tabs.push({ id: tabId, title: '' })
    out.terminalLayoutRootsByTabId[tabId] = layout?.root
    const ptyIds = filterPtyIds(ptyIdsByTabId[tabId] ?? [], layout, homedLeafIds, true)
    if (ptyIds.length > 0) {
      out.ptyIdsByTabId[tabId] = ptyIds
    }
    const titles = filterPaneTitles(
      runtimePaneTitlesByTabId[tabId] ?? {},
      runtimePaneTitleLeafIdsByTabId[tabId],
      layout,
      ptyIdsByTabId[tabId] ?? [],
      homedLeafIds,
      true
    )
    if (titles.length > 0) {
      out.runtimePaneTitlesByTabId[tabId] = Object.fromEntries(titles)
    }
  }
  return out.tabs.length > 0 ? out : null
}
