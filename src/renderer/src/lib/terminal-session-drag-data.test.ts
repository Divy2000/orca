import { afterEach, describe, expect, it } from 'vitest'
import {
  clearActiveTerminalSessionDrag,
  getActiveTerminalSessionDrag,
  hasTerminalSessionDragData,
  readTerminalSessionDragData,
  TERMINAL_SESSION_DRAG_TYPE,
  writeTerminalSessionDragData
} from './terminal-session-drag-data'

const PANE_KEY = 'tab-a:11111111-1111-4111-8111-111111111111'

/** The DataTransfer surface drag sources and drop targets touch. */
function fakeDataTransfer(): DataTransfer {
  const data = new Map<string, string>()
  const transfer = {
    effectAllowed: 'all',
    dropEffect: 'none',
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? ''
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the module reads only the fields faked above.
  return transfer as unknown as DataTransfer
}

afterEach(() => {
  clearActiveTerminalSessionDrag()
})

describe('terminal session drag data', () => {
  it('given a dragged agent row, it carries the pane and workspace as a move', () => {
    const transfer = fakeDataTransfer()

    writeTerminalSessionDragData(transfer, { paneKey: PANE_KEY, worktreeId: 'wt-a' })

    expect(transfer.effectAllowed).toBe('move')
    expect(transfer.types).toEqual([TERMINAL_SESSION_DRAG_TYPE])
    expect(hasTerminalSessionDragData(transfer)).toBe(true)
    expect(readTerminalSessionDragData(transfer)).toEqual({
      paneKey: PANE_KEY,
      worktreeId: 'wt-a'
    })
  })

  it('given a drag in flight, dragover can read it before the payload is readable', () => {
    writeTerminalSessionDragData(fakeDataTransfer(), { paneKey: PANE_KEY, worktreeId: 'wt-a' })

    expect(getActiveTerminalSessionDrag()).toEqual({ paneKey: PANE_KEY, worktreeId: 'wt-a' })

    clearActiveTerminalSessionDrag()
    expect(getActiveTerminalSessionDrag()).toBeNull()
  })

  it.each([
    ['not JSON', '{'],
    ['a missing workspace', JSON.stringify({ paneKey: PANE_KEY })],
    ['a malformed pane key', JSON.stringify({ paneKey: 'nope', worktreeId: 'wt-a' })],
    ['no pane key', JSON.stringify({ paneKey: null, worktreeId: 'wt-a' })],
    ['an oversized payload', JSON.stringify({ paneKey: PANE_KEY, worktreeId: 'w'.repeat(20_000) })]
  ])('given %s, it reads no payload', (_label, raw) => {
    const transfer = fakeDataTransfer()
    transfer.setData(TERMINAL_SESSION_DRAG_TYPE, raw)

    expect(readTerminalSessionDragData(transfer)).toBeNull()
  })

  it('given another kind of drag, it is not a terminal session drag', () => {
    const transfer = fakeDataTransfer()
    transfer.setData('application/x-orca-worktree-id', 'wt-a')

    expect(hasTerminalSessionDragData(transfer)).toBe(false)
    expect(readTerminalSessionDragData(transfer)).toBeNull()
  })
})
