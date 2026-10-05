import type { PaneExternalDropTarget } from '@/lib/pane-manager/pane-manager'
import { resolveDropZone, resolveDropZoneRect } from '@/lib/pane-manager/pane-drop-zone'
import { isTerminalLeafId, makePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalPaneDropZone } from './terminal-pane-cross-workspace-move'
import { getElementsFromPoint } from './terminal-tab-strip-drop-target'

const TERMINAL_PANE_SELECTOR = '.pane[data-leaf-id]'
const TERMINAL_SURFACE_SELECTOR = '[data-terminal-tab-id]'
// Why: elementsFromPoint also lists panes painted beneath the board sheet or a dialog.
const OCCLUDING_SURFACE_SELECTOR = '[data-workspace-board-sheet], [role="dialog"]'

export type TerminalPaneSplitDropTarget = PaneExternalDropTarget & {
  kind: 'pane-split'
  paneKey: string
  tabId: string
  zone: TerminalPaneDropZone
}

/** The pane under the pointer in any visible terminal tab, and the edge a dropped pane would join. */
export function resolveTerminalPaneSplitDropTarget(args: {
  clientX: number
  clientY: number
  excludeTabId: string | null
}): TerminalPaneSplitDropTarget | null {
  for (const element of getElementsFromPoint(args.clientX, args.clientY)) {
    if (element.closest(OCCLUDING_SURFACE_SELECTOR)) {
      return null
    }
    const pane = element.closest<HTMLElement>(TERMINAL_PANE_SELECTOR)
    if (!pane) {
      continue
    }
    const tabId = pane.closest<HTMLElement>(TERMINAL_SURFACE_SELECTOR)?.dataset.terminalTabId
    const leafId = pane.dataset.leafId
    if (
      !tabId ||
      tabId.includes(':') ||
      tabId === args.excludeTabId ||
      !leafId ||
      !isTerminalLeafId(leafId)
    ) {
      return null
    }
    const paneRect = pane.getBoundingClientRect()
    const zone = resolveDropZone(args.clientX, args.clientY, paneRect)
    const paneKey = makePaneKey(tabId, leafId)
    return {
      kind: 'pane-split',
      id: `${paneKey}:${zone}`,
      paneKey,
      tabId,
      zone,
      overlayKind: 'area',
      rect: resolveDropZoneRect(paneRect, zone)
    }
  }
  return null
}

export function isTerminalPaneSplitDropTarget(
  target: PaneExternalDropTarget
): target is TerminalPaneSplitDropTarget {
  return 'kind' in target && target.kind === 'pane-split'
}
