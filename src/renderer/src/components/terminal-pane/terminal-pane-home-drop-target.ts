import type { PaneExternalDropTarget } from '@/lib/pane-manager/pane-manager'
import { getElementsFromPoint } from './terminal-tab-strip-drop-target'

/** Marks the surface (the workspace sidebar) where dropping a foreign pane sends it home. */
export const TERMINAL_PANE_HOME_DROP_TARGET_ATTRIBUTE = 'data-terminal-pane-home-drop-target'

export type TerminalPaneHomeDropTarget = PaneExternalDropTarget & { kind: 'pane-home' }

function pointWithinRect(clientX: number, clientY: number, rect: DOMRect): boolean {
  return (
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  )
}

export function resolveTerminalPaneHomeDropTarget(args: {
  clientX: number
  clientY: number
}): TerminalPaneHomeDropTarget | null {
  for (const element of getElementsFromPoint(args.clientX, args.clientY)) {
    const surface = element.closest<HTMLElement>(`[${TERMINAL_PANE_HOME_DROP_TARGET_ATTRIBUTE}]`)
    if (!surface) {
      continue
    }
    const rect = surface.getBoundingClientRect()
    return pointWithinRect(args.clientX, args.clientY, rect)
      ? { kind: 'pane-home', id: 'pane-home', overlayKind: 'area', rect }
      : null
  }
  return null
}

export function isTerminalPaneHomeDropTarget(
  target: PaneExternalDropTarget
): target is TerminalPaneHomeDropTarget {
  return 'kind' in target && target.kind === 'pane-home'
}
