import { useEffect, useMemo } from 'react'
import type React from 'react'
import {
  getActiveTerminalSessionDrag,
  hasTerminalSessionDragData,
  readTerminalSessionDragData
} from '@/lib/terminal-session-drag-data'
import {
  commitTerminalSessionDrop,
  endTerminalSessionDrag,
  resolveTerminalSessionDropTarget,
  showTerminalSessionDropOverlay
} from './terminal-session-drop'

type SurfaceDragEvent = React.DragEvent<HTMLElement>

export type TerminalSessionDropHandlers = {
  /** True when the event is a terminal dragged from the sidebar, so file handlers can skip it. */
  onDragOver: (event: SurfaceDragEvent) => boolean
  onDragLeave: (event: SurfaceDragEvent) => void
}

let documentDropRetainCount = 0

function handleDocumentDrop(event: DragEvent): void {
  if (!event.dataTransfer || !hasTerminalSessionDragData(event.dataTransfer)) {
    return
  }
  const payload = readTerminalSessionDragData(event.dataTransfer) ?? getActiveTerminalSessionDrag()
  const target = payload
    ? resolveTerminalSessionDropTarget(event.clientX, event.clientY, payload)
    : null
  endTerminalSessionDrag()
  if (!payload || !target) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  commitTerminalSessionDrop(payload, target)
}

// Why: the preload's capture listener stops drops before React's root sees them, so the
// commit runs from one shared document capture listener, like the sidebar's own drops.
function retainTerminalSessionDocumentDrop(): () => void {
  if (documentDropRetainCount === 0) {
    document.addEventListener('drop', handleDocumentDrop, true)
  }
  documentDropRetainCount += 1
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    documentDropRetainCount -= 1
    if (documentDropRetainCount === 0) {
      document.removeEventListener('drop', handleDocumentDrop, true)
    }
  }
}

/** Lets a terminal surface accept a terminal dragged from the sidebar into one of its splits. */
export function useTerminalSessionDrop(): TerminalSessionDropHandlers {
  useEffect(() => retainTerminalSessionDocumentDrop(), [])
  return useMemo(
    () => ({
      onDragOver: (event) => {
        if (!hasTerminalSessionDragData(event.dataTransfer)) {
          return false
        }
        const payload = getActiveTerminalSessionDrag()
        const target = payload
          ? resolveTerminalSessionDropTarget(event.clientX, event.clientY, payload)
          : null
        showTerminalSessionDropOverlay(target)
        if (target) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }
        return true
      },
      onDragLeave: (event) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) {
          return
        }
        showTerminalSessionDropOverlay(null)
      }
    }),
    []
  )
}
