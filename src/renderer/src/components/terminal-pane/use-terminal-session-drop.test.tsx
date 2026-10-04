// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearActiveTerminalSessionDrag,
  writeTerminalSessionDragData
} from '@/lib/terminal-session-drag-data'

const mocks = vi.hoisted(() => ({
  resolveTarget: vi.fn(),
  commit: vi.fn(),
  showOverlay: vi.fn(),
  endDrag: vi.fn()
}))
vi.mock('./terminal-session-drop', () => ({
  resolveTerminalSessionDropTarget: mocks.resolveTarget,
  commitTerminalSessionDrop: mocks.commit,
  showTerminalSessionDropOverlay: mocks.showOverlay,
  endTerminalSessionDrag: mocks.endDrag
}))

import { useTerminalSessionDrop } from './use-terminal-session-drop'

const PAYLOAD = { paneKey: 'tab-a:11111111-1111-4111-8111-111111111111', worktreeId: 'wt-a' }
const TARGET = { kind: 'pane-split', paneKey: 'tab-b:x', zone: 'left' }

function dataTransfer(types: Record<string, string>): DataTransfer {
  const data = new Map(Object.entries(types))
  const transfer = {
    dropEffect: 'none',
    effectAllowed: 'all',
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? ''
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads only the fields faked above.
  return transfer as unknown as DataTransfer
}

function Surface({ onOtherDrop }: { onOtherDrop: () => void }): React.JSX.Element {
  const drop = useTerminalSessionDrop()
  return (
    <div
      data-testid="surface"
      onDragOver={(event) => {
        drop.onDragOver(event)
      }}
      onDragLeave={drop.onDragLeave}
      onDrop={onOtherDrop}
    >
      <div data-testid="pane" />
    </div>
  )
}

/** Dispatches a drag event that keeps `transfer` itself, so writes like dropEffect are observable. */
function dispatchDrag(
  target: Element,
  type: 'dragover' | 'drop',
  transfer: DataTransfer,
  point = { clientX: 0, clientY: 0 }
): boolean {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...point })
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  let notCanceled = true
  act(() => {
    notCanceled = target.dispatchEvent(event)
  })
  return !notCanceled
}

function sessionTransfer(): DataTransfer {
  const transfer = dataTransfer({})
  writeTerminalSessionDragData(transfer, PAYLOAD)
  return transfer
}

afterEach(() => {
  cleanup()
  clearActiveTerminalSessionDrag()
  vi.clearAllMocks()
})

describe('useTerminalSessionDrop', () => {
  it('given a sidebar terminal over a pane edge, it accepts the drop and shows the edge', () => {
    mocks.resolveTarget.mockReturnValue(TARGET)
    const view = render(<Surface onOtherDrop={vi.fn()} />)
    const transfer = sessionTransfer()

    const accepted = dispatchDrag(view.getByTestId('pane'), 'dragover', transfer, {
      clientX: 3,
      clientY: 4
    })

    expect(accepted).toBe(true)
    expect(transfer.dropEffect).toBe('move')
    expect(mocks.resolveTarget).toHaveBeenCalledWith(3, 4, PAYLOAD)
    expect(mocks.showOverlay).toHaveBeenLastCalledWith(TARGET)
  })

  it('given no pane edge under the pointer, it refuses the drop and hides the edge', () => {
    mocks.resolveTarget.mockReturnValue(null)
    const view = render(<Surface onOtherDrop={vi.fn()} />)

    const accepted = dispatchDrag(view.getByTestId('pane'), 'dragover', sessionTransfer())

    expect(accepted).toBe(false)
    expect(mocks.showOverlay).toHaveBeenLastCalledWith(null)
  })

  it('given the drop, it moves the dragged terminal into that edge before other handlers see it', () => {
    mocks.resolveTarget.mockReturnValue(TARGET)
    const onOtherDrop = vi.fn()
    const view = render(<Surface onOtherDrop={onOtherDrop} />)

    const handled = dispatchDrag(view.getByTestId('pane'), 'drop', sessionTransfer())

    expect(handled).toBe(true)
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    expect(mocks.commit).toHaveBeenCalledWith(PAYLOAD, TARGET)
    expect(mocks.endDrag).toHaveBeenCalled()
    expect(onOtherDrop).not.toHaveBeenCalled()
  })

  it('given several mounted surfaces, one drop commits once', () => {
    mocks.resolveTarget.mockReturnValue(TARGET)
    const view = render(
      <>
        <Surface onOtherDrop={vi.fn()} />
        <Surface onOtherDrop={vi.fn()} />
      </>
    )

    dispatchDrag(view.getAllByTestId('pane')[0], 'drop', sessionTransfer())

    expect(mocks.commit).toHaveBeenCalledTimes(1)
  })

  it('given no pane edge under a drop, it ends the drag without moving anything', () => {
    mocks.resolveTarget.mockReturnValue(null)
    const view = render(<Surface onOtherDrop={vi.fn()} />)

    dispatchDrag(view.getByTestId('pane'), 'drop', sessionTransfer())

    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.endDrag).toHaveBeenCalled()
  })

  it('given every surface unmounted, a later drop is no longer handled', () => {
    mocks.resolveTarget.mockReturnValue(TARGET)
    const view = render(<Surface onOtherDrop={vi.fn()} />)
    view.unmount()

    dispatchDrag(document.body, 'drop', sessionTransfer())

    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('given the pointer leaves the surface, it hides the edge', () => {
    const view = render(<Surface onOtherDrop={vi.fn()} />)

    fireEvent.dragLeave(view.getByTestId('surface'), { relatedTarget: document.body })

    expect(mocks.showOverlay).toHaveBeenCalledWith(null)
  })

  it('given another kind of drag, it leaves it to the other drop handlers', () => {
    const onOtherDrop = vi.fn()
    const view = render(<Surface onOtherDrop={onOtherDrop} />)
    const files = dataTransfer({ 'text/x-orca-file-path': '/a' })

    const accepted = dispatchDrag(view.getByTestId('pane'), 'dragover', files)
    dispatchDrag(view.getByTestId('pane'), 'drop', files)

    expect(accepted).toBe(false)
    expect(mocks.resolveTarget).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(onOtherDrop).toHaveBeenCalled()
  })
})
