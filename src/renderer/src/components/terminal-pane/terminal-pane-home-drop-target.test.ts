// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isTerminalPaneHomeDropTarget,
  resolveTerminalPaneHomeDropTarget,
  TERMINAL_PANE_HOME_DROP_TARGET_ATTRIBUTE
} from './terminal-pane-home-drop-target'

const SIDEBAR_RECT = { left: 0, top: 0, width: 240, height: 600 }

function domRect(box: typeof SIDEBAR_RECT): DOMRect {
  return {
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => ({})
  }
}

function mountSidebar(): HTMLElement {
  const sidebar = document.createElement('div')
  sidebar.setAttribute(TERMINAL_PANE_HOME_DROP_TARGET_ATTRIBUTE, '')
  sidebar.getBoundingClientRect = () => domRect(SIDEBAR_RECT)
  const row = document.createElement('div')
  sidebar.append(row)
  document.body.append(sidebar)
  return row
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('resolveTerminalPaneHomeDropTarget', () => {
  it('given a pointer over the sidebar, it targets the whole sidebar', () => {
    const row = mountSidebar()
    document.elementsFromPoint = vi.fn(() => [row])

    const target = resolveTerminalPaneHomeDropTarget({ clientX: 40, clientY: 300 })

    expect(target).toMatchObject({
      kind: 'pane-home',
      overlayKind: 'area',
      rect: { left: 0, top: 0, width: 240, height: 600 }
    })
    expect(target && isTerminalPaneHomeDropTarget(target)).toBe(true)
  })

  it('given a pointer outside the sidebar, it offers no target', () => {
    mountSidebar()
    document.elementsFromPoint = vi.fn(() => [document.body])

    expect(resolveTerminalPaneHomeDropTarget({ clientX: 400, clientY: 300 })).toBeNull()
  })

  it('given a sidebar element reported outside its own bounds, it offers no target', () => {
    const row = mountSidebar()
    document.elementsFromPoint = vi.fn(() => [row])

    expect(resolveTerminalPaneHomeDropTarget({ clientX: 400, clientY: 300 })).toBeNull()
  })
})
