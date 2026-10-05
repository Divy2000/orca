import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  findAgentPaneWorktreeId,
  findCompletedOrphanPaneKeysForTabClose,
  findTabForAgentEntry
} from './agent-status-pane-key-tab-binding'

const W1 = 'repo-1::/work/w1'
const W2 = 'repo-1::/work/w2'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'
const FOREIGN_PANE = `tab-w2:${FOREIGN_LEAF}`
const NATIVE_PANE = `tab-w2:${NATIVE_LEAF}`

function tab(id: string, worktreeId: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function entry(overrides: Partial<AgentStatusEntry> & { paneKey: string }): AgentStatusEntry {
  return {
    state: 'done',
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    stateHistory: [],
    ...overrides
  }
}

const hostLayout: TerminalLayoutSnapshot = {
  root: {
    type: 'split',
    direction: 'vertical',
    first: { type: 'leaf', leafId: NATIVE_LEAF },
    second: { type: 'leaf', leafId: FOREIGN_LEAF }
  },
  activeLeafId: NATIVE_LEAF,
  expandedLeafId: null,
  homeByLeafId: {
    [FOREIGN_LEAF]: { worktreeId: W1, sessionTabId: 'tab-w1', sessionLeafId: FOREIGN_LEAF }
  }
}

function state(agentStatusByPaneKey: Record<string, AgentStatusEntry> = {}) {
  return {
    tabsByWorktree: { [W1]: [tab('tab-w1', W1)], [W2]: [tab('tab-w2', W2)] },
    terminalLayoutsByTabId: { 'tab-w2': hostLayout },
    agentStatusByPaneKey
  }
}

describe('findAgentPaneWorktreeId', () => {
  it('given a pane hosted in a W2 tab with home W1 then it resolves W1', () => {
    expect(findAgentPaneWorktreeId(state(), FOREIGN_PANE)).toBe(W1)
  })

  it('given a native pane of the same tab then it resolves the tab owner', () => {
    expect(findAgentPaneWorktreeId(state(), NATIVE_PANE)).toBe(W2)
  })
})

describe('findTabForAgentEntry', () => {
  it('given a foreign pane looked up under its home then it finds the host tab', () => {
    expect(findTabForAgentEntry(state(), W1, entry({ paneKey: FOREIGN_PANE }))?.id).toBe('tab-w2')
  })

  it('given a native pane looked up under another workspace then it finds nothing', () => {
    expect(findTabForAgentEntry(state(), W1, entry({ paneKey: NATIVE_PANE }))).toBeUndefined()
  })

  it('given a native pane looked up under its owner then it finds the tab', () => {
    expect(findTabForAgentEntry(state(), W2, entry({ paneKey: NATIVE_PANE }))?.id).toBe('tab-w2')
  })
})

describe('findCompletedOrphanPaneKeysForTabClose', () => {
  it('given a done W1 row on a pane hosted in an open W2 tab when an unrelated W1 tab closes then the row survives', () => {
    const rows = { [FOREIGN_PANE]: entry({ paneKey: FOREIGN_PANE, worktreeId: W1 }) }

    expect(findCompletedOrphanPaneKeysForTabClose(state(rows), W1, 'tab-closed:')).toEqual([])
  })

  it('given a done W1 row whose tab no longer exists when a W1 tab closes then the row is swept', () => {
    const orphanPane = `tab-gone:${NATIVE_LEAF}`
    const rows = { [orphanPane]: entry({ paneKey: orphanPane, worktreeId: W1 }) }

    expect(findCompletedOrphanPaneKeysForTabClose(state(rows), W1, 'tab-closed:')).toEqual([
      orphanPane
    ])
  })
})
