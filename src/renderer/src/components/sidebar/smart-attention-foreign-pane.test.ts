import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/terminal-tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { buildAttentionByWorktree, IDLE } from './smart-attention'

const NOW = new Date('2026-03-27T12:00:00.000Z').getTime()
const W1 = 'repo::/w1'
const W2 = 'repo::/w2'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'
const FOREIGN_PANE = `host-tab:${FOREIGN_LEAF}`

function worktree(id: string): Worktree {
  return {
    id,
    repoId: 'repo',
    path: `/tmp/${id}`,
    branch: `refs/heads/${id}`,
    head: 'abc',
    isBare: false,
    isMainWorktree: false,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    comment: '',
    isUnread: false,
    isPinned: false,
    displayName: id,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

function hostTab(): TerminalTab {
  return {
    id: 'host-tab',
    ptyId: 'pty-native',
    worktreeId: W2,
    title: 'bash',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function hostLayout(withHome: boolean): Record<string, TerminalLayoutSnapshot> {
  return {
    'host-tab': {
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
                worktreeId: W1,
                sessionTabId: 'w1-tab',
                sessionLeafId: FOREIGN_LEAF
              }
            }
          }
        : {})
    }
  }
}

function attention(withHome: boolean, titles: Record<string, Record<number, string>> = {}) {
  const entries: Record<string, AgentStatusEntry> = {
    [FOREIGN_PANE]: {
      state: 'working',
      prompt: '',
      updatedAt: NOW - 1_000,
      stateStartedAt: NOW - 5_000,
      agentType: 'codex',
      paneKey: FOREIGN_PANE,
      worktreeId: W1,
      stateHistory: []
    }
  }
  return buildAttentionByWorktree(
    [worktree(W1), worktree(W2)],
    { [W1]: [], [W2]: [hostTab()] },
    entries,
    titles,
    { 'host-tab': ['pty-native', 'pty-foreign'] },
    NOW,
    undefined,
    hostLayout(withHome)
  )
}

describe('buildAttentionByWorktree with a pane hosted for another workspace', () => {
  it('given a working hook row on the foreign pane then its home is working and the host idle', () => {
    const map = attention(true)

    expect(map.get(W1)?.cls).toBe(3)
    expect(map.get(W2)).toEqual(IDLE)
  })

  it('given a working title on the foreign pane then its home is working and the host idle', () => {
    // Runtime pane 2 is the second leaf in replay order: the foreign one.
    const map = buildAttentionByWorktree(
      [worktree(W1), worktree(W2)],
      { [W1]: [], [W2]: [hostTab()] },
      {},
      { 'host-tab': { 1: 'bash', 2: '⠋ Claude Code' } },
      { 'host-tab': ['pty-native', 'pty-foreign'] },
      NOW,
      undefined,
      hostLayout(true)
    )

    expect(map.get(W1)?.cls).toBe(3)
    expect(map.get(W2)).toEqual(IDLE)
  })

  it('given a remote row whose pane key collides with the foreign pane then the home is not credited', () => {
    const remote: AgentStatusEntry = {
      state: 'working',
      prompt: '',
      updatedAt: NOW - 1_000,
      stateStartedAt: NOW - 5_000,
      agentType: 'codex',
      paneKey: FOREIGN_PANE,
      worktreeId: 'remote-wt',
      connectionId: 'ssh-1',
      stateHistory: []
    }
    const map = buildAttentionByWorktree(
      [worktree(W1), worktree(W2)],
      { [W1]: [], [W2]: [hostTab()] },
      { [FOREIGN_PANE]: remote },
      {},
      { 'host-tab': ['pty-native', 'pty-foreign'] },
      NOW,
      undefined,
      hostLayout(true)
    )

    expect(map.get(W1)).toEqual(IDLE)
  })

  it('given a permission title bound to the foreign leaf a fresh hook covers then the home stays working', () => {
    const working: AgentStatusEntry = {
      state: 'working',
      prompt: '',
      updatedAt: NOW - 1_000,
      stateStartedAt: NOW - 5_000,
      agentType: 'codex',
      paneKey: FOREIGN_PANE,
      worktreeId: W1,
      stateHistory: []
    }
    const map = buildAttentionByWorktree(
      [worktree(W1), worktree(W2)],
      { [W1]: [], [W2]: [hostTab()] },
      { [FOREIGN_PANE]: working },
      { 'host-tab': { 1: 'Codex - action required' } },
      { 'host-tab': ['pty-native', 'pty-foreign'] },
      NOW,
      undefined,
      hostLayout(true),
      { 'host-tab': { 1: FOREIGN_LEAF } }
    )

    expect(map.get(W1)?.cls).toBe(3)
  })

  it('given no home entry then the row counts for the host tab owner as before', () => {
    const map = attention(false)

    expect(map.get(W2)?.cls).toBe(3)
    expect(map.get(W1)).toEqual(IDLE)
  })
})
