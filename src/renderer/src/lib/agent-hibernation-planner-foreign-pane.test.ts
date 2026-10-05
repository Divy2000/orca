import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'
import {
  DEFAULT_AGENT_HIBERNATION_IDLE_MS,
  planAgentHibernationCandidates,
  type AgentHibernationPlannerSnapshot
} from './agent-hibernation-planner'

const NOW = 2_000_000
const OLD = NOW - DEFAULT_AGENT_HIBERNATION_IDLE_MS - 1
const HOST = 'wt-host'
const HOME = 'wt-home'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'

function hostTab(): TerminalTab {
  return {
    id: 'host-tab',
    ptyId: null,
    worktreeId: HOST,
    title: 'Agent',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function hostLayout(withHome: boolean): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: NATIVE_LEAF },
      second: { type: 'leaf', leafId: FOREIGN_LEAF }
    },
    activeLeafId: NATIVE_LEAF,
    expandedLeafId: null,
    ptyIdsByLeafId: { [NATIVE_LEAF]: 'pty-native', [FOREIGN_LEAF]: 'pty-foreign' },
    ...(withHome
      ? {
          homeByLeafId: {
            [FOREIGN_LEAF]: {
              worktreeId: HOME,
              sessionTabId: 'home-tab',
              sessionLeafId: FOREIGN_LEAF
            }
          }
        }
      : {})
  }
}

function doneEntry(leafId: string, worktreeId: string): AgentStatusEntry {
  return {
    state: 'done',
    prompt: 'make it so',
    updatedAt: OLD,
    stateStartedAt: OLD,
    paneKey: `host-tab:${leafId}`,
    tabId: 'host-tab',
    worktreeId,
    agentType: 'claude',
    providerSession: { key: 'session_id', id: `session-${leafId}` },
    stateHistory: []
  }
}

function snapshot(withHome: boolean, entries: AgentStatusEntry[]): AgentHibernationPlannerSnapshot {
  return {
    settings: {
      experimentalAgentHibernation: true,
      agentHibernationIdleMs: DEFAULT_AGENT_HIBERNATION_IDLE_MS
    },
    activeWorktreeId: 'wt-active',
    foregroundTerminalTabIds: [],
    tabsByWorktree: { [HOST]: [hostTab()], [HOME]: [] },
    terminalLayoutsByTabId: { 'host-tab': hostLayout(withHome) },
    ptyIdsByTabId: { 'host-tab': ['pty-native', 'pty-foreign'] },
    mobileLockedPtyIds: [],
    agentStatusByPaneKey: Object.fromEntries(entries.map((entry) => [entry.paneKey, entry])),
    sleepingAgentSessionsByPaneKey: {},
    lastTerminalInputAtByPaneKey: {},
    foregroundTerminalLastSeenAtByTabId: {},
    now: NOW
  }
}

describe('agent sleep planner for a pane hosted in another workspace tab', () => {
  it('given a completed resumable agent stamped with its home then it is planned with both identities', () => {
    const [candidate] = planAgentHibernationCandidates(
      snapshot(true, [doneEntry(FOREIGN_LEAF, HOME)])
    )

    expect(candidate).toMatchObject({
      worktreeId: HOST,
      homeWorktreeId: HOME,
      tabId: 'host-tab',
      leafId: FOREIGN_LEAF,
      targetPtyIds: ['pty-foreign']
    })
  })

  it('given a native pane of the same tab then it is planned with only its tab owner', () => {
    const [candidate] = planAgentHibernationCandidates(
      snapshot(true, [doneEntry(NATIVE_LEAF, HOST)])
    )

    expect(candidate?.worktreeId).toBe(HOST)
    expect(candidate).not.toHaveProperty('homeWorktreeId')
  })

  it('given a row stamped with another workspace on a native pane then it is still refused', () => {
    expect(
      planAgentHibernationCandidates(snapshot(false, [doneEntry(FOREIGN_LEAF, HOME)]))
    ).toEqual([])
  })
})
