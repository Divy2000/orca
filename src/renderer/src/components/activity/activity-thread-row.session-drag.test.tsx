// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  clearActiveTerminalSessionDrag,
  getActiveTerminalSessionDrag,
  TERMINAL_SESSION_DRAG_TYPE
} from '@/lib/terminal-session-drag-data'
import { ActivityThreadRow } from './activity-thread-row'
import type { AgentPaneThread } from './activity-thread-types'
import { makeRepo, makeTab, makeWorktree } from './ActivityPrototypePage-test-fixtures'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ endTerminalSessionDrag: vi.fn() }))

vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: () => null,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('@/components/terminal-pane/terminal-session-drop', () => ({
  endTerminalSessionDrag: mocks.endTerminalSessionDrag
}))

const LEAF = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `tab-1:${LEAF}`

function seedLivePane(): void {
  useAppStore.setState({
    terminalLayoutsByTabId: {
      'tab-1': { root: { type: 'leaf', leafId: LEAF }, activeLeafId: LEAF, expandedLeafId: null }
    }
  })
}

beforeEach(seedLivePane)

function thread(paneKey = PANE_KEY): AgentPaneThread {
  return {
    paneKey,
    tab: makeTab(),
    worktree: makeWorktree(),
    repo: makeRepo(),
    agentType: 'claude',
    latestEvent: null,
    currentAgentState: 'working',
    currentAgentEntry: null,
    events: [],
    unread: false,
    paneTitle: 'Audit',
    responsePreview: 'Auditing',
    latestTimestamp: 1700000000000
  }
}

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
  clearActiveTerminalSessionDrag()
  vi.clearAllMocks()
})

function renderRow(rowThread: AgentPaneThread): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <TooltipProvider>
        <ActivityThreadRow
          thread={rowThread}
          selected={false}
          onSelect={vi.fn()}
          onJump={vi.fn()}
          onMarkRead={vi.fn()}
          onMarkUnread={vi.fn()}
          canJump
          compactMode={false}
        />
      </TooltipProvider>
    )
  })
  return container.querySelector<HTMLElement>('[role="listitem"]')!
}

function dragStart(row: HTMLElement): Map<string, string> {
  const transfer = new Map<string, string>()
  const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { effectAllowed: 'all', setData: (type: string, v: string) => transfer.set(type, v) }
  })
  act(() => {
    row.dispatchEvent(event)
  })
  return transfer
}

describe('ActivityThreadRow terminal drag', () => {
  it('given an agent thread row, dragging it carries that agent’s terminal pane', () => {
    const rowThread = thread()
    const row = renderRow(rowThread)

    expect(row.getAttribute('draggable')).toBe('true')
    const transfer = dragStart(row)

    const payload = { paneKey: PANE_KEY, worktreeId: rowThread.worktree.id }
    expect(JSON.parse(transfer.get(TERMINAL_SESSION_DRAG_TYPE) ?? '{}')).toEqual(payload)
    expect(getActiveTerminalSessionDrag()).toEqual(payload)
  })

  it('given the drag ends, it clears the terminal drag', () => {
    const row = renderRow(thread())

    act(() => {
      row.dispatchEvent(new MouseEvent('dragend', { bubbles: true }))
    })

    expect(mocks.endTerminalSessionDrag).toHaveBeenCalled()
  })

  it.each([
    ['a thread without a pane key', 'legacy-row'],
    ['a stale thread whose pane is gone', 'tab-1:22222222-2222-4222-8222-222222222222'],
    ['a thread whose tab is closed', `tab-closed:${LEAF}`]
  ])('given %s, it is not draggable', (_label, paneKey) => {
    const row = renderRow(thread(paneKey))

    expect(row.getAttribute('draggable')).toBe('false')
    expect(dragStart(row).size).toBe(0)
  })
})
