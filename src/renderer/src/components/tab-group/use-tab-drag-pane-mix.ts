import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DragEndEvent, DragMoveEvent } from '@dnd-kit/core'
import { useAppStore } from '../../store'
import { requestTerminalPaneMoveIntoSplit } from '../terminal-pane/terminal-pane-move-action'
import {
  resolveTerminalPaneSplitDropTarget,
  type TerminalPaneSplitDropTarget
} from '../terminal-pane/terminal-pane-split-drop-target'
import {
  removeTerminalSessionDropOverlay,
  resolveTerminalTabActivePaneKey,
  showTerminalSessionDropOverlay
} from '../terminal-pane/terminal-session-drop'
import { isTabDragData, type TabDragItemData } from './tab-drag-data'
import { getDragPointer } from './tab-drag-pointer'

type ShiftKeyEvent = KeyboardEvent | PointerEvent

export type TabDragPaneMix = {
  begin: (drag: TabDragItemData, opts?: { shiftKey?: boolean }) => void
  /** True while Shift holds a terminal tab over another tab's pane, replacing group targets. */
  update: (event: DragMoveEvent) => boolean
  /** The mix to run once the tab drag has fully finished, or null for a regular tab drop. */
  resolveDrop: (event: DragEndEvent) => (() => void) | null
  clear: () => void
}

/**
 * Shift-dragging a terminal tab onto a pane mixes the tab's active pane into that pane's split;
 * a tab left empty closes. Shift is the same key on every platform.
 */
export function useTabDragPaneMix(): TabDragPaneMix {
  const shiftHeldRef = useRef(false)
  const stopTrackingRef = useRef<(() => void) | null>(null)

  /** The tab's pane and the pane edge it would join, while Shift holds a terminal tab over one. */
  const resolveMix = useCallback(
    (
      event: DragMoveEvent | DragEndEvent
    ): { sourcePaneKey: string; target: TerminalPaneSplitDropTarget } | null => {
      const drag = event.active.data.current
      const pointer = getDragPointer(event)
      if (
        !shiftHeldRef.current ||
        !isTabDragData(drag) ||
        drag.tabType !== 'terminal' ||
        !pointer
      ) {
        return null
      }
      const sourcePaneKey = resolveTerminalTabActivePaneKey(
        useAppStore.getState(),
        drag.visibleTabId
      )
      const target = sourcePaneKey
        ? resolveTerminalPaneSplitDropTarget({
            clientX: pointer.x,
            clientY: pointer.y,
            excludeTabId: drag.visibleTabId
          })
        : null
      return sourcePaneKey && target ? { sourcePaneKey, target } : null
    },
    []
  )

  const clear = useCallback(() => {
    stopTrackingRef.current?.()
    stopTrackingRef.current = null
    shiftHeldRef.current = false
    removeTerminalSessionDropOverlay()
  }, [])

  const begin = useCallback(
    (drag: TabDragItemData, opts: { shiftKey?: boolean } = {}) => {
      clear()
      if (drag.tabType !== 'terminal') {
        return
      }
      shiftHeldRef.current = opts.shiftKey === true
      const track = (event: ShiftKeyEvent): void => {
        shiftHeldRef.current = event.shiftKey
      }
      window.addEventListener('keydown', track, true)
      window.addEventListener('keyup', track, true)
      window.addEventListener('pointermove', track, true)
      stopTrackingRef.current = () => {
        window.removeEventListener('keydown', track, true)
        window.removeEventListener('keyup', track, true)
        window.removeEventListener('pointermove', track, true)
      }
    },
    [clear]
  )

  const update = useCallback(
    (event: DragMoveEvent) => {
      const mix = resolveMix(event)
      showTerminalSessionDropOverlay(mix?.target ?? null)
      return mix !== null
    },
    [resolveMix]
  )

  const resolveDrop = useCallback(
    (event: DragEndEvent) => {
      const mix = resolveMix(event)
      return mix
        ? () =>
            requestTerminalPaneMoveIntoSplit(mix.sourcePaneKey, mix.target.paneKey, mix.target.zone)
        : null
    },
    [resolveMix]
  )

  useEffect(() => clear, [clear])

  return useMemo(() => ({ begin, update, resolveDrop, clear }), [begin, clear, resolveDrop, update])
}
