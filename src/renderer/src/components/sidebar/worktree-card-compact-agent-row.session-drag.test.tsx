/** @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { DashboardAgentRow as DashboardAgentRowData } from '@/components/dashboard/useDashboardData'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  clearActiveTerminalSessionDrag,
  getActiveTerminalSessionDrag,
  TERMINAL_SESSION_DRAG_TYPE
} from '@/lib/terminal-session-drag-data'
import { CompactAgentRow } from './worktree-card-compact-agent-row'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ endTerminalSessionDrag: vi.fn() }))

vi.mock('@/components/dashboard/use-agent-row-conversation-name', () => ({
  useAgentRowConversationName: () => null
}))
vi.mock('./CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownForPane: () => null
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

function makeAgent(overrides: Partial<DashboardAgentRowData> = {}): DashboardAgentRowData {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the row reads only these fields.
  return {
    paneKey: PANE_KEY,
    tab: { id: 'tab-1', worktreeId: 'wt-1' },
    agentType: 'claude',
    state: 'working',
    startedAt: 500,
    entry: { prompt: 'do the task', state: 'working', stateStartedAt: 1000, paneKey: PANE_KEY },
    ...overrides
  } as unknown as DashboardAgentRowData
}

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
  clearActiveTerminalSessionDrag()
  vi.clearAllMocks()
})

function renderRow(
  agent: DashboardAgentRowData,
  sendTargetStatus?: 'eligible' | 'disabled' | 'sending'
): HTMLElement {
  const container = document.createElement('div')
  const parent = document.createElement('div')
  parent.append(container)
  document.body.appendChild(parent)
  root = createRoot(container)
  act(() => {
    root!.render(
      <TooltipProvider>
        <CompactAgentRow
          agent={agent}
          now={2000}
          onActivate={() => {}}
          sendTargetStatus={sendTargetStatus}
        />
      </TooltipProvider>
    )
  })
  return container.querySelector<HTMLElement>('.compact-agent-row')!
}

function dragStart(row: HTMLElement): { transfer: Map<string, string>; bubbled: boolean } {
  const transfer = new Map<string, string>()
  let bubbled = false
  row.parentElement!.parentElement!.addEventListener('dragstart', () => {
    bubbled = true
  })
  const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { effectAllowed: 'all', setData: (type: string, v: string) => transfer.set(type, v) }
  })
  act(() => {
    row.dispatchEvent(event)
  })
  return { transfer, bubbled }
}

describe('CompactAgentRow terminal drag', () => {
  it('given a live agent row, dragging it carries its terminal pane without dragging the card', () => {
    const row = renderRow(makeAgent())

    expect(row.getAttribute('draggable')).toBe('true')
    const { transfer, bubbled } = dragStart(row)

    expect(JSON.parse(transfer.get(TERMINAL_SESSION_DRAG_TYPE) ?? '{}')).toEqual({
      paneKey: PANE_KEY,
      worktreeId: 'wt-1'
    })
    expect(getActiveTerminalSessionDrag()).toEqual({ paneKey: PANE_KEY, worktreeId: 'wt-1' })
    expect(bubbled).toBe(false)
  })

  it('given the drag ends, it clears the terminal drag', () => {
    const row = renderRow(makeAgent())

    act(() => {
      row.dispatchEvent(new MouseEvent('dragend', { bubbles: true }))
    })

    expect(mocks.endTerminalSessionDrag).toHaveBeenCalled()
  })

  it.each([
    ['a subagent row', makeAgent({ rowSource: 'subagent' }), undefined],
    ['a row without a pane key', makeAgent({ paneKey: 'synthetic-row' }), undefined],
    ['a send-target pick', makeAgent(), 'eligible' as const],
    [
      'a retained row whose pane is gone',
      makeAgent({ rowSource: 'retained', paneKey: 'tab-1:22222222-2222-4222-8222-222222222222' }),
      undefined
    ],
    ['a row whose tab is closed', makeAgent({ paneKey: `tab-closed:${LEAF}` }), undefined]
  ])('given %s, it is not draggable', (_label, agent, sendTargetStatus) => {
    const row = renderRow(agent, sendTargetStatus)

    expect(row.getAttribute('draggable')).toBe('false')
    expect(dragStart(row).transfer.size).toBe(0)
  })
})
