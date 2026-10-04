import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import {
  parseAgentStatusPaneIdentity,
  resolveAgentStatusWorktreeId
} from './agent-status-worktree-attribution'

function entry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
    state: 'working',
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    stateHistory: [],
    ...overrides
  }
}

describe('agent status worktree attribution', () => {
  it('uses the pane tab before a stale worktree stamp', () => {
    expect(
      resolveAgentStatusWorktreeId(
        entry({ worktreeId: 'stale-worktree' }),
        new Map([['tab-1', 'current-worktree']])
      )
    ).toBe('current-worktree')
  })

  it('falls back to a parent pane tab for a pre-mirror worker', () => {
    expect(
      resolveAgentStatusWorktreeId(
        entry({
          paneKey: 'worker-tab:22222222-2222-4222-8222-222222222222',
          orchestration: {
            taskId: 'task-1',
            dispatchId: 'dispatch-1',
            parentPaneKey: 'parent-tab:1'
          }
        }),
        new Map([['parent-tab', 'parent-worktree']])
      )
    ).toBe('parent-worktree')
  })

  it('parses legacy numeric pane identities consistently', () => {
    expect(parseAgentStatusPaneIdentity('tab-1:7')).toEqual({ tabId: 'tab-1', paneId: '7' })
  })
})

it.each([
  { connectionId: 'host-a' },
  { paneKey: 'web-terminal-shared:11111111-1111-4111-8111-111111111111' }
])('keeps the remote owner when another workspace has the same tab ID: %o', (remote) => {
  const row = entry({ worktreeId: 'host-a-workspace', ...remote })
  const tabId = row.paneKey.split(':')[0]
  expect(resolveAgentStatusWorktreeId(row, new Map([[tabId, 'host-b-workspace']]))).toBe(
    'host-a-workspace'
  )
})

describe('foreign pane attribution', () => {
  const FOREIGN_PANE = 'host-tab:22222222-2222-4222-8222-222222222222'
  const homeByPaneKey = new Map([[FOREIGN_PANE, 'home-worktree']])

  it('given W1 row on a pane hosted in a W2 tab then it resolves to W1', () => {
    expect(
      resolveAgentStatusWorktreeId(
        entry({ paneKey: FOREIGN_PANE, worktreeId: 'home-worktree' }),
        new Map([['host-tab', 'host-worktree']]),
        undefined,
        homeByPaneKey
      )
    ).toBe('home-worktree')
  })

  it('lets the home win over a stale worktree stamp naming the host', () => {
    expect(
      resolveAgentStatusWorktreeId(
        entry({ paneKey: FOREIGN_PANE, worktreeId: 'host-worktree' }),
        new Map([['host-tab', 'host-worktree']]),
        undefined,
        homeByPaneKey
      )
    ).toBe('home-worktree')
  })

  it('given a remote row whose pane key collides with a local foreign pane then the host-reported workspace wins', () => {
    expect(
      resolveAgentStatusWorktreeId(
        entry({ paneKey: FOREIGN_PANE, worktreeId: 'remote-wt', connectionId: 'ssh-1' }),
        new Map([['host-tab', 'host-worktree']]),
        undefined,
        homeByPaneKey
      )
    ).toBe('remote-wt')
  })

  it('keeps native panes of the same tab on the host', () => {
    expect(
      resolveAgentStatusWorktreeId(
        entry({ paneKey: 'host-tab:11111111-1111-4111-8111-111111111111' }),
        new Map([['host-tab', 'host-worktree']]),
        undefined,
        homeByPaneKey
      )
    ).toBe('host-worktree')
  })
})
