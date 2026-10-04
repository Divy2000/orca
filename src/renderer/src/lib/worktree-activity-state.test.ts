import { describe, expect, it } from 'vitest'
import {
  getLiveAgentStatusByWorktreeId,
  getWorktreeIdsWithLiveAgent,
  isInactiveWorkspace
} from './worktree-activity-state'
import type {
  TerminalLayoutSnapshot,
  TerminalLeafHome,
  TerminalTab
} from '../../../shared/terminal-tab-types'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'

const NOW = 10_000_000

function makeTab(id: string): Pick<TerminalTab, 'id'> {
  return { id }
}

function makeAgentEntry(
  overrides: Partial<AgentStatusEntry> & { paneKey: string }
): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW,
    stateHistory: [],
    ...overrides
  }
}

describe('worktree activity state', () => {
  it('treats a never-opened workspace as inactive', () => {
    expect(isInactiveWorkspace('wt-1', {}, {}, {}, new Set())).toBe(true)
  })

  it('treats live terminal workspaces as active', () => {
    const tabsByWorktree = { 'wt-1': [makeTab('tab-1')] }
    const ptyIdsByTabId = { 'tab-1': ['pty-1'] }

    expect(isInactiveWorkspace('wt-1', tabsByWorktree, ptyIdsByTabId, {}, new Set())).toBe(false)
  })

  it('treats browser workspaces as active', () => {
    expect(
      isInactiveWorkspace(
        'wt-1',
        { 'wt-1': [makeTab('tab-1')] },
        { 'tab-1': [] },
        { 'wt-1': [{ id: 'browser-1' }] },
        new Set()
      )
    ).toBe(false)
  })

  it('treats pending paired web host terminal mirrors as inactive without a live pty', () => {
    expect(
      isInactiveWorkspace(
        'wt-1',
        { 'wt-1': [makeTab('web-terminal-host-tab-1')] },
        {},
        {},
        new Set()
      )
    ).toBe(true)
  })

  it('treats ready paired web host terminal mirrors as active with a live pty', () => {
    expect(
      isInactiveWorkspace(
        'wt-1',
        { 'wt-1': [makeTab('web-terminal-host-tab-1')] },
        { 'web-terminal-host-tab-1': ['pty-1'] },
        {},
        new Set()
      )
    ).toBe(false)
  })

  it('keeps browser-only workspaces active when mirrored terminals are pending', () => {
    expect(
      isInactiveWorkspace(
        'wt-1',
        { 'wt-1': [makeTab('web-terminal-host-tab-1')] },
        {},
        { 'wt-1': [{ id: 'browser-1' }] },
        new Set()
      )
    ).toBe(false)
  })

  it('keeps a workspace with a running agent active even without a live pty (#7197)', () => {
    const worktreeIdsWithLiveAgent = new Set(['wt-1'])
    expect(
      isInactiveWorkspace(
        'wt-1',
        { 'wt-1': [makeTab('tab-1')] },
        { 'tab-1': [] },
        {},
        worktreeIdsWithLiveAgent
      )
    ).toBe(false)
  })

  it('still hides a slept workspace with no live agent entry', () => {
    expect(
      isInactiveWorkspace('wt-1', { 'wt-1': [makeTab('tab-1')] }, { 'tab-1': [] }, {}, new Set())
    ).toBe(true)
  })
})

describe('getWorktreeIdsWithLiveAgent', () => {
  it('returns an empty set when there are no agent entries', () => {
    expect(getWorktreeIdsWithLiveAgent({}, {}, NOW)).toEqual(new Set())
    expect(getWorktreeIdsWithLiveAgent(null, null, NOW)).toEqual(new Set())
  })

  it('attributes an entry by its main-stamped worktreeId', () => {
    const entries = {
      'tab-1:leaf-1': makeAgentEntry({ paneKey: 'tab-1:leaf-1', worktreeId: 'wt-1' })
    }
    expect(getWorktreeIdsWithLiveAgent(entries, {}, NOW)).toEqual(new Set(['wt-1']))
  })

  it('falls back to the paneKey tabId when worktreeId is absent', () => {
    const entries = {
      'tab-1:00000000-0000-4000-8000-000000000000': makeAgentEntry({
        paneKey: 'tab-1:00000000-0000-4000-8000-000000000000'
      })
    }
    expect(getWorktreeIdsWithLiveAgent(entries, { 'wt-1': [makeTab('tab-1')] }, NOW)).toEqual(
      new Set(['wt-1'])
    )
  })

  it('ignores entries that cannot be attributed to any worktree', () => {
    const entries = {
      'orphan:00000000-0000-4000-8000-000000000000': makeAgentEntry({
        paneKey: 'orphan:00000000-0000-4000-8000-000000000000'
      })
    }
    expect(getWorktreeIdsWithLiveAgent(entries, {}, NOW)).toEqual(new Set())
  })

  it('ignores completed headless agents without an open session', () => {
    const entries = {
      'tab-1:leaf-1': makeAgentEntry({
        paneKey: 'tab-1:leaf-1',
        worktreeId: 'wt-1',
        state: 'done'
      })
    }

    expect(getWorktreeIdsWithLiveAgent(entries, {}, NOW)).toEqual(new Set())
  })

  it('ignores stale status left behind after an SSH disconnect', () => {
    const entries = {
      'tab-1:leaf-1': makeAgentEntry({
        paneKey: 'tab-1:leaf-1',
        worktreeId: 'wt-1',
        updatedAt: 0
      })
    }

    expect(getWorktreeIdsWithLiveAgent(entries, {}, NOW)).toEqual(new Set())
  })

  it.each(['working', 'blocked', 'waiting'] as const)(
    'keeps a fresh %s agent visible during a PTY gap',
    (state) => {
      const entries = {
        'tab-1:leaf-1': makeAgentEntry({
          paneKey: 'tab-1:leaf-1',
          worktreeId: 'wt-1',
          state
        })
      }

      expect(getWorktreeIdsWithLiveAgent(entries, {}, NOW)).toEqual(new Set(['wt-1']))
    }
  )

  it('reports working and permission states with permission taking priority', () => {
    const entries = {
      'tab-1:leaf-1': makeAgentEntry({
        paneKey: 'tab-1:leaf-1',
        worktreeId: 'wt-1',
        state: 'working'
      }),
      'tab-2:leaf-2': makeAgentEntry({
        paneKey: 'tab-2:leaf-2',
        worktreeId: 'wt-2',
        state: 'working'
      }),
      'tab-3:leaf-3': makeAgentEntry({
        paneKey: 'tab-3:leaf-3',
        worktreeId: 'wt-2',
        state: 'blocked'
      })
    }

    expect(getLiveAgentStatusByWorktreeId(entries, {}, NOW)).toEqual(
      new Map([
        ['wt-1', 'working'],
        ['wt-2', 'permission']
      ])
    )
  })

  it('reports monitoring below active working and permission', () => {
    const entries = {
      'tab-1:leaf-1': makeAgentEntry({
        paneKey: 'tab-1:leaf-1',
        worktreeId: 'wt-1',
        workingMode: 'monitoring'
      }),
      'tab-2:leaf-2': makeAgentEntry({
        paneKey: 'tab-2:leaf-2',
        worktreeId: 'wt-2',
        workingMode: 'monitoring'
      }),
      'tab-3:leaf-3': makeAgentEntry({
        paneKey: 'tab-3:leaf-3',
        worktreeId: 'wt-2'
      }),
      'tab-4:leaf-4': makeAgentEntry({
        paneKey: 'tab-4:leaf-4',
        worktreeId: 'wt-3',
        workingMode: 'monitoring'
      }),
      'tab-5:leaf-5': makeAgentEntry({
        paneKey: 'tab-5:leaf-5',
        worktreeId: 'wt-3',
        state: 'waiting'
      })
    }

    expect(getLiveAgentStatusByWorktreeId(entries, {}, NOW)).toEqual(
      new Map([
        ['wt-1', 'monitoring'],
        ['wt-2', 'working'],
        ['wt-3', 'permission']
      ])
    )
  })
})

describe('foreign pane attribution', () => {
  const W1 = 'repo-1::/work/w1'
  const W2 = 'repo-1::/work/w2'
  const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
  const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'
  const home: TerminalLeafHome = {
    worktreeId: W1,
    sessionTabId: 'tab-w1',
    sessionLeafId: FOREIGN_LEAF
  }

  function hostLayout(
    ptyIdsByLeafId: Record<string, string> = {}
  ): Record<string, TerminalLayoutSnapshot> {
    return {
      'tab-w2': {
        root: {
          type: 'split',
          direction: 'vertical',
          first: { type: 'leaf', leafId: NATIVE_LEAF },
          second: { type: 'leaf', leafId: FOREIGN_LEAF }
        },
        activeLeafId: NATIVE_LEAF,
        expandedLeafId: null,
        homeByLeafId: { [FOREIGN_LEAF]: home },
        ptyIdsByLeafId
      }
    }
  }

  const tabsByWorktree = { [W1]: [makeTab('tab-w1')], [W2]: [makeTab('tab-w2')] }

  it('given W1 working row on a pane hosted in a W2 tab then W1 is working and W2 is not', () => {
    const entries = {
      [`tab-w2:${FOREIGN_LEAF}`]: makeAgentEntry({
        paneKey: `tab-w2:${FOREIGN_LEAF}`,
        worktreeId: W1
      })
    }

    expect(getLiveAgentStatusByWorktreeId(entries, tabsByWorktree, NOW, hostLayout())).toEqual(
      new Map([[W1, 'working']])
    )
  })

  it('attributes a foreign pane row without a worktree stamp to its home', () => {
    const entries = {
      [`tab-w2:${FOREIGN_LEAF}`]: makeAgentEntry({ paneKey: `tab-w2:${FOREIGN_LEAF}` })
    }

    expect(getWorktreeIdsWithLiveAgent(entries, tabsByWorktree, NOW, hostLayout())).toEqual(
      new Set([W1])
    )
  })

  it('keeps a native pane row in the same tab attributed to the host', () => {
    const entries = {
      [`tab-w2:${NATIVE_LEAF}`]: makeAgentEntry({ paneKey: `tab-w2:${NATIVE_LEAF}` })
    }

    expect(getLiveAgentStatusByWorktreeId(entries, tabsByWorktree, NOW, hostLayout())).toEqual(
      new Map([[W2, 'working']])
    )
  })

  it('counts a live foreign pty for its home and not for a host with no native pty', () => {
    const layouts = hostLayout({ [FOREIGN_LEAF]: 'pty-foreign' })
    const ptyIdsByTabId = { 'tab-w2': ['pty-foreign'] }

    expect(
      isInactiveWorkspace(W1, tabsByWorktree, ptyIdsByTabId, {}, new Set(), new Set(), layouts)
    ).toBe(false)
    expect(
      isInactiveWorkspace(W2, tabsByWorktree, ptyIdsByTabId, {}, new Set(), new Set(), layouts)
    ).toBe(true)
  })

  it('given a foreign leaf whose pty binding has not hydrated then the host is not kept active by it', () => {
    const layouts = hostLayout({ [NATIVE_LEAF]: 'pty-native' })
    const ptyIdsByTabId = { 'tab-w2': ['pty-foreign'] }

    expect(
      isInactiveWorkspace(W2, tabsByWorktree, ptyIdsByTabId, {}, new Set(), new Set(), layouts)
    ).toBe(true)
  })

  it('keeps the host active when its tab also has a live native pty', () => {
    const layouts = hostLayout({ [FOREIGN_LEAF]: 'pty-foreign', [NATIVE_LEAF]: 'pty-native' })
    const ptyIdsByTabId = { 'tab-w2': ['pty-native', 'pty-foreign'] }

    expect(
      isInactiveWorkspace(W2, tabsByWorktree, ptyIdsByTabId, {}, new Set(), new Set(), layouts)
    ).toBe(false)
  })

  it('does not count a home whose foreign pane has no live pty', () => {
    const layouts = hostLayout({ [FOREIGN_LEAF]: 'pty-foreign' })

    expect(
      isInactiveWorkspace(W1, tabsByWorktree, { 'tab-w2': [] }, {}, new Set(), new Set(), layouts)
    ).toBe(true)
  })
})
