import type { DropZone } from './pane-manager-types'

/** The pane edge nearest the pointer, which decides where a dropped pane splits in. */
export function resolveDropZone(clientX: number, clientY: number, rect: DOMRect): DropZone {
  const relX = (clientX - rect.left) / rect.width
  const relY = (clientY - rect.top) / rect.height
  const distances: [DropZone, number][] = [
    ['top', relY],
    ['bottom', 1 - relY],
    ['left', relX],
    ['right', 1 - relX]
  ]
  return distances.sort((a, b) => a[1] - b[1])[0]?.[0] ?? 'right'
}

/** The half of the pane a drop in `zone` would occupy. */
export function resolveDropZoneRect(rect: DOMRect, zone: DropZone): DOMRect {
  const halfWidth = rect.width / 2
  const halfHeight = rect.height / 2
  const left = rect.left + (zone === 'right' ? halfWidth : 0)
  const top = rect.top + (zone === 'bottom' ? halfHeight : 0)
  const width = zone === 'left' || zone === 'right' ? halfWidth : rect.width
  const height = zone === 'top' || zone === 'bottom' ? halfHeight : rect.height
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({ left, top, width, height })
  }
}

/** Shows the drop overlay over `rect` (viewport coordinates). */
export function positionDropOverlayRect(
  overlay: HTMLElement,
  rect: DOMRect,
  kind: 'area' | 'insertion' = 'area'
): void {
  overlay.style.display = ''
  // Why: the stylesheet hides pane header controls while any marked overlay is shown.
  overlay.dataset.paneDropVisible = ''
  overlay.dataset.paneDropOverlayKind = kind
  overlay.style.left = `${rect.left + window.scrollX}px`
  overlay.style.top = `${rect.top + window.scrollY}px`
  overlay.style.width = `${rect.width}px`
  overlay.style.height = `${rect.height}px`
}

export function hideDropOverlayRect(overlay: HTMLElement): void {
  overlay.style.display = 'none'
  delete overlay.dataset.paneDropVisible
}

export function positionDropOverlay(overlay: HTMLElement, rect: DOMRect, zone: DropZone): void {
  positionDropOverlayRect(overlay, resolveDropZoneRect(rect, zone))
}
