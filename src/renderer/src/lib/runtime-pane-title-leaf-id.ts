import { FIRST_PANE_ID } from '../../../shared/pane-key'
import { isTerminalLeafId } from '../../../shared/stable-pane-id'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode
} from '../../../shared/terminal-tab-types'

export type RuntimePaneTitleLeafResolution = {
  title: string | null
  hasAnyPaneTitle: boolean
}

function getLeftmostLeafId(node: TerminalPaneLayoutNode): string {
  return node.type === 'leaf' ? node.leafId : getLeftmostLeafId(node.first)
}

function collectReplayCreatedPaneLeafIds(
  node: TerminalPaneLayoutNode,
  leafIdsInReplayCreationOrder: string[]
): void {
  if (node.type === 'leaf') {
    return
  }

  leafIdsInReplayCreationOrder.push(getLeftmostLeafId(node.second))

  if (node.first.type === 'split') {
    collectReplayCreatedPaneLeafIds(node.first, leafIdsInReplayCreationOrder)
  }
  if (node.second.type === 'split') {
    collectReplayCreatedPaneLeafIds(node.second, leafIdsInReplayCreationOrder)
  }
}

function collectLeafIdsInReplayCreationOrder(
  node: TerminalPaneLayoutNode | null | undefined
): string[] {
  if (!node) {
    return []
  }
  const leafIdsInReplayCreationOrder = [getLeftmostLeafId(node)]
  if (node.type === 'split') {
    collectReplayCreatedPaneLeafIds(node, leafIdsInReplayCreationOrder)
  }
  return leafIdsInReplayCreationOrder
}

export function collectRuntimePaneLeafIds(
  node: TerminalPaneLayoutNode | null | undefined
): string[] {
  if (!node) {
    return []
  }
  if (node.type === 'leaf') {
    return [node.leafId]
  }
  return [...collectRuntimePaneLeafIds(node.first), ...collectRuntimePaneLeafIds(node.second)]
}

/** The leaf each runtime pane title of one tab was written for (store `runtimePaneTitleLeafIdsByTabId`). */
export type RuntimePaneTitleLeafIds = Readonly<Record<number, string>> | undefined

export function resolveRuntimePaneTitleLeafId(
  tabLayout: { root?: TerminalLayoutSnapshot['root'] } | undefined,
  runtimePaneId: string,
  paneTitleLeafIds?: RuntimePaneTitleLeafIds
): string | null {
  return resolveRuntimePaneTitleLeafIdFromRoot(tabLayout?.root, runtimePaneId, paneTitleLeafIds)
}

/**
 * Resolve the runtime-reported pane title for a specific layout leaf. Pane
 * title maps are keyed by runtime pane id, which only lines up with the leaf id
 * after replay-order resolution — split tabs can carry a sparse title map, so a
 * lone background title must not be attributed to an unrelated leaf.
 */
export function resolveRuntimePaneTitleForLeaf(
  tabLayout: { root?: TerminalLayoutSnapshot['root'] } | undefined,
  paneTitles: Record<number, string> | undefined,
  leafId: string,
  paneTitleLeafIds?: RuntimePaneTitleLeafIds
): string | null {
  return resolveRuntimePaneTitleLeafResolution(tabLayout, paneTitles, leafId, paneTitleLeafIds)
    .title
}

export function resolveRuntimePaneTitleLeafResolution(
  tabLayout: { root?: TerminalLayoutSnapshot['root'] } | undefined,
  paneTitles: Record<number, string> | undefined,
  leafId: string,
  paneTitleLeafIds?: RuntimePaneTitleLeafIds
): RuntimePaneTitleLeafResolution {
  if (!paneTitles) {
    return { title: null, hasAnyPaneTitle: false }
  }

  const titlesByPaneId = paneTitles as Record<string, string>
  let firstTitle: string | null = null
  let hasOnePaneTitle = false
  let hasMultiplePaneTitles = false

  for (const runtimePaneId in titlesByPaneId) {
    if (!Object.hasOwn(titlesByPaneId, runtimePaneId)) {
      continue
    }

    const title = titlesByPaneId[runtimePaneId]
    if (hasOnePaneTitle) {
      hasMultiplePaneTitles = true
    } else {
      firstTitle = title
      hasOnePaneTitle = true
    }

    if (resolveRuntimePaneTitleLeafId(tabLayout, runtimePaneId, paneTitleLeafIds) === leafId) {
      return { title, hasAnyPaneTitle: true }
    }
  }

  // Why: without a layout root, only a single reported pane title can be
  // attributed; any pane title still suppresses stale tab-title fallback.
  if (!tabLayout?.root && hasOnePaneTitle && !hasMultiplePaneTitles) {
    return { title: firstTitle, hasAnyPaneTitle: true }
  }

  return { title: null, hasAnyPaneTitle: hasOnePaneTitle }
}

/**
 * The leaf a runtime pane title belongs to. The title writer's recorded leaf wins; replay
 * creation order is only a fallback for titles written without one (legacy or parked data).
 */
export function resolveRuntimePaneTitleLeafIdFromRoot(
  root: TerminalPaneLayoutNode | null | undefined,
  runtimePaneId: string,
  paneTitleLeafIds?: RuntimePaneTitleLeafIds
): string | null {
  if (isTerminalLeafId(runtimePaneId)) {
    return runtimePaneId
  }
  const boundLeafId = paneTitleLeafIds?.[Number(runtimePaneId)]
  if (boundLeafId) {
    return boundLeafId
  }
  const numericPaneId = Number(runtimePaneId)
  if (!Number.isInteger(numericPaneId) || numericPaneId < FIRST_PANE_ID) {
    return null
  }
  const leafIds = collectLeafIdsInReplayCreationOrder(root)
  return leafIds[numericPaneId - FIRST_PANE_ID] ?? null
}

/**
 * Resolve a sparse live runtime pane slot through the tab's current PTY bindings.
 * PaneManager ids survive closes with gaps, while the live PTY list retains order.
 */
export function resolveRuntimePaneTitleLeafIdFromSparseSlots(args: {
  layout: Pick<TerminalLayoutSnapshot, 'ptyIdsByLeafId'> | undefined
  paneId: number
  liveSlotIds: number[]
  ptyIds: string[]
}): string | null {
  if (args.ptyIds.length !== args.liveSlotIds.length) {
    return null
  }
  const paneIndex = args.liveSlotIds.indexOf(args.paneId)
  const ptyId = paneIndex === -1 ? undefined : args.ptyIds[paneIndex]
  if (!ptyId) {
    return null
  }
  const boundLeafIds = Object.entries(args.layout?.ptyIdsByLeafId ?? {})
    .filter(([, boundPtyId]) => boundPtyId === ptyId)
    .map(([leafId]) => leafId)
  return boundLeafIds.length === 1 ? boundLeafIds[0] : null
}

/**
 * The leaf a runtime pane title belongs to: the writer's recorded leaf binding when one exists,
 * else by slot or PTY binding alone — the single leaf, a
 * parked `-(leafIndex + 1)` slot, a dense creation-order id, or a sparse id bound through the
 * tab's live PTYs. Null when none places it; callers decide whether to guess further.
 */
export function resolveRuntimePaneTitleSlotLeafId(args: {
  layout: Pick<TerminalLayoutSnapshot, 'root' | 'ptyIdsByLeafId'> | undefined
  leafIds: string[]
  ptyIds: string[]
  liveSlotIds: number[]
  liveSlotsAreDense: boolean
  paneId: number
  /** The leaves the title writers recorded; slot order is only a fallback for legacy titles. */
  paneTitleLeafIds?: RuntimePaneTitleLeafIds
}): string | null {
  const boundLeafId = args.paneTitleLeafIds?.[args.paneId]
  if (boundLeafId) {
    return boundLeafId
  }
  if (args.leafIds.length === 1) {
    return args.leafIds[0]
  }
  if (args.paneId < FIRST_PANE_ID) {
    // Parked slots are defined off the in-order leaf list, so invert that definition.
    return args.leafIds[-args.paneId - 1] ?? null
  }
  if (args.liveSlotsAreDense) {
    const creationOrderLeafId = resolveRuntimePaneTitleLeafIdFromRoot(
      args.layout?.root,
      String(args.paneId)
    )
    if (creationOrderLeafId) {
      return creationOrderLeafId
    }
  }
  // After an in-session close, PaneManager ids are sparse while the tab's live
  // PTYs retain their relative order. Use the durable PTY-to-leaf bindings to
  // recover the exact leaf instead of assigning a survivor by layout position.
  return resolveRuntimePaneTitleLeafIdFromSparseSlots({
    layout: args.layout,
    paneId: args.paneId,
    liveSlotIds: args.liveSlotIds,
    ptyIds: args.ptyIds
  })
}
