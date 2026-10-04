import { describe, expect, it } from 'vitest'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/terminal-tab-types'
import { buildWorktreeAgentRows } from './worktree-agent-rows'
import {
  mergeHostedAgentRowInputs,
  selectHostedAgentRowInputs
} from './worktree-hosted-pane-agent-row-inputs'

const W1 = 'repo::/w1'
const W2 = 'repo::/w2'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'
const FOREIGN_PANE = `host-tab:${FOREIGN_LEAF}`
const NOW = 100_000_000

function hostTab(): TerminalTab {
  return {
    id: 'host-tab',
    ptyId: 'pty-native',
    worktreeId: W2,
    title: 'zsh',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
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
  ptyIdsByLeafId: { [NATIVE_LEAF]: 'pty-native', [FOREIGN_LEAF]: 'pty-foreign' },
  homeByLeafId: {
    [FOREIGN_LEAF]: { worktreeId: W1, sessionTabId: 'w1-tab', sessionLeafId: FOREIGN_LEAF }
  }
}

const state = {
  tabsByWorktree: { [W1]: [], [W2]: [hostTab()] },
  terminalLayoutsByTabId: { 'host-tab': hostLayout },
  ptyIdsByTabId: { 'host-tab': ['pty-native', 'pty-foreign'] },
  runtimePaneTitlesByTabId: {}
}

const staleWorking: AgentStatusEntry = {
  paneKey: FOREIGN_PANE,
  state: 'working',
  prompt: '',
  updatedAt: NOW - AGENT_STATUS_STALE_AFTER_MS - 1,
  stateStartedAt: NOW - AGENT_STATUS_STALE_AFTER_MS - 1,
  stateHistory: [],
  agentType: 'claude',
  worktreeId: W1
}

function homeRows(withHostedInputs: boolean) {
  const own = {
    tabs: [],
    ptyIdsByTabId: {},
    runtimePaneTitlesByTabId: {},
    terminalLayoutsByTabId: {}
  }
  const inputs = withHostedInputs
    ? mergeHostedAgentRowInputs(own, W1, selectHostedAgentRowInputs(state, W1))
    : own
  return buildWorktreeAgentRows({ ...inputs, entries: [staleWorking], retained: [], now: NOW })
}

describe('agent rows for a pane hosted in another workspace tab', () => {
  it('given a stale working row on a live foreign pane then its home row keeps the host tab and live PTY', () => {
    const [row] = homeRows(true)

    expect(row?.state).toBe('unverifiable')
    expect(row?.tab.id).toBe('host-tab')
    expect(row?.tab.worktreeId).toBe(W2)
  })

  it('given no host projection then the same row decays to idle on a synthetic tab', () => {
    const [row] = homeRows(false)

    expect(row?.state).toBe('idle')
  })

  it('strips the foreign pane from the host rows', () => {
    const merged = mergeHostedAgentRowInputs(
      {
        tabs: [hostTab()],
        ptyIdsByTabId: state.ptyIdsByTabId,
        runtimePaneTitlesByTabId: { 'host-tab': { 1: 'zsh', 2: '⠋ Claude Code' } },
        terminalLayoutsByTabId: { 'host-tab': hostLayout }
      },
      W2,
      selectHostedAgentRowInputs(state, W2)
    )

    expect(merged.ptyIdsByTabId).toEqual({ 'host-tab': ['pty-native'] })
    expect(merged.runtimePaneTitlesByTabId).toEqual({ 'host-tab': { 1: 'zsh' } })
  })
})
