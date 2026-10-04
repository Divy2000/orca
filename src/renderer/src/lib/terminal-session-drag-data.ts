import { parsePaneKey } from '../../../shared/stable-pane-id'

export const TERMINAL_SESSION_DRAG_TYPE = 'application/x-orca-terminal-pane'
const TERMINAL_SESSION_DRAG_PAYLOAD_MAX_LENGTH = 16 * 1024

/** A live terminal pane dragged from the sidebar. */
export type TerminalSessionDragPayload = {
  paneKey: string
  worktreeId: string
}

// Why: dragover cannot read DataTransfer payloads, so targets validate against the live drag.
let activeTerminalSessionDrag: TerminalSessionDragPayload | null = null

export function getActiveTerminalSessionDrag(): TerminalSessionDragPayload | null {
  return activeTerminalSessionDrag
}

export function clearActiveTerminalSessionDrag(): void {
  activeTerminalSessionDrag = null
}

export function writeTerminalSessionDragData(
  dataTransfer: DataTransfer,
  payload: TerminalSessionDragPayload
): void {
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(TERMINAL_SESSION_DRAG_TYPE, JSON.stringify(payload))
  activeTerminalSessionDrag = payload
}

export function hasTerminalSessionDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(TERMINAL_SESSION_DRAG_TYPE)
}

function parsePayload(value: unknown): TerminalSessionDragPayload | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const paneKey: unknown = Reflect.get(value, 'paneKey')
  const worktreeId: unknown = Reflect.get(value, 'worktreeId')
  if (typeof worktreeId !== 'string' || worktreeId.length === 0) {
    return null
  }
  return typeof paneKey === 'string' && parsePaneKey(paneKey) ? { paneKey, worktreeId } : null
}

export function readTerminalSessionDragData(
  dataTransfer: DataTransfer
): TerminalSessionDragPayload | null {
  const raw = dataTransfer.getData(TERMINAL_SESSION_DRAG_TYPE)
  if (!raw || raw.length > TERMINAL_SESSION_DRAG_PAYLOAD_MAX_LENGTH) {
    return null
  }
  try {
    return parsePayload(JSON.parse(raw))
  } catch {
    // Malformed payloads come from outside Orca's own drag sources; ignore them.
    return null
  }
}
