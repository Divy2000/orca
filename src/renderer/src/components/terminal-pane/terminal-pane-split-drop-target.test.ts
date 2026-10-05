// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isTerminalPaneSplitDropTarget,
  resolveTerminalPaneSplitDropTarget
} from './terminal-pane-split-drop-target'

const LEAF = '11111111-1111-4111-8111-111111111111'
const PANE_RECT = { left: 100, top: 0, width: 200, height: 100 }

function domRect(box: typeof PANE_RECT): DOMRect {
  return {
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => ({})
  }
}

/** A terminal surface for `tabId` holding one pane, with xterm content inside it. */
function mountPane(tabId: string, leafId = LEAF): { pane: HTMLElement; content: HTMLElement } {
  const surface = document.createElement('div')
  surface.dataset.terminalTabId = tabId
  const pane = document.createElement('div')
  pane.className = 'pane'
  pane.dataset.leafId = leafId
  pane.getBoundingClientRect = () => domRect(PANE_RECT)
  const content = document.createElement('div')
  pane.append(content)
  surface.append(pane)
  document.body.append(surface)
  return { pane, content }
}

function stubElementsAtPoint(elements: Element[]): void {
  document.elementsFromPoint = vi.fn(() => elements)
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('resolveTerminalPaneSplitDropTarget', () => {
  it('given a pointer over another tab’s pane near its right edge, it targets that edge', () => {
    const { content } = mountPane('tab-target')
    stubElementsAtPoint([content])

    const target = resolveTerminalPaneSplitDropTarget({
      clientX: 290,
      clientY: 50,
      excludeTabId: 'tab-source'
    })

    expect(target).toMatchObject({
      kind: 'pane-split',
      paneKey: `tab-target:${LEAF}`,
      tabId: 'tab-target',
      zone: 'right',
      overlayKind: 'area',
      rect: { left: 200, top: 0, width: 100, height: 100 }
    })
    expect(target && isTerminalPaneSplitDropTarget(target)).toBe(true)
  })

  it('given a pane title overlay above the pane, it still finds the pane beneath', () => {
    const { pane } = mountPane('tab-target')
    const titleBar = document.createElement('div')
    document.body.append(titleBar)
    stubElementsAtPoint([titleBar, pane])

    expect(
      resolveTerminalPaneSplitDropTarget({ clientX: 110, clientY: 50, excludeTabId: null })
    ).toMatchObject({ paneKey: `tab-target:${LEAF}`, zone: 'left' })
  })

  it('given the pointer over the dragged tab’s own pane, it offers no target', () => {
    const { content } = mountPane('tab-source')
    stubElementsAtPoint([content])

    expect(
      resolveTerminalPaneSplitDropTarget({ clientX: 290, clientY: 50, excludeTabId: 'tab-source' })
    ).toBeNull()
  })

  it('given a board or dialog covering the pane, it offers no target', () => {
    const { content } = mountPane('tab-target')
    const board = document.createElement('div')
    board.setAttribute('data-workspace-board-sheet', '')
    const boardCard = document.createElement('div')
    board.append(boardCard)
    document.body.append(board)
    stubElementsAtPoint([boardCard, content])

    expect(
      resolveTerminalPaneSplitDropTarget({ clientX: 290, clientY: 50, excludeTabId: null })
    ).toBeNull()
  })

  it('given a pane without a stable leaf id, it offers no target', () => {
    const { content } = mountPane('tab-target', 'not-a-uuid')
    stubElementsAtPoint([content])

    expect(
      resolveTerminalPaneSplitDropTarget({ clientX: 290, clientY: 50, excludeTabId: null })
    ).toBeNull()
  })

  it('given nothing under the pointer, it offers no target', () => {
    stubElementsAtPoint([])

    expect(
      resolveTerminalPaneSplitDropTarget({ clientX: 0, clientY: 0, excludeTabId: null })
    ).toBeNull()
  })
})
