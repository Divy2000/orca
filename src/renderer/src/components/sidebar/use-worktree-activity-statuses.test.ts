import { describe, expect, it } from 'vitest'
import { shallow } from 'zustand/shallow'
import { selectWorktreeActivityStatuses } from './use-worktree-activity-statuses'

type StatusState = Parameters<typeof selectWorktreeActivityStatuses>[0]

function makeStatusState(): StatusState {
  return {
    tabsByWorktree: {},
    browserTabsByWorktree: {},
    runtimePaneTitlesByTabId: {},
    ptyIdsByTabId: {},
    terminalLayoutsByTabId: {},
    agentStatusEpoch: 0,
    agentStatusByPaneKey: {},
    migrationUnsupportedByPtyId: {},
    retainedAgentsByPaneKey: {},
    runtimeAgentOrchestrationByPaneKey: {}
  }
}

describe('selectWorktreeActivityStatuses', () => {
  it('stays shallow-equal when an unrelated worktree receives activity updates', () => {
    const state = makeStatusState()
    const unrelatedUpdate: StatusState = {
      ...state,
      agentStatusEpoch: 1,
      browserTabsByWorktree: {
        other: []
      },
      runtimePaneTitlesByTabId: {
        'other-tab': { 0: 'codex [working]' }
      },
      ptyIdsByTabId: {
        'other-tab': ['other-pty']
      }
    }

    expect(
      shallow(
        selectWorktreeActivityStatuses(state, ['visible']),
        selectWorktreeActivityStatuses(unrelatedUpdate, ['visible'])
      )
    ).toBe(true)
  })
})

describe('selectWorktreeActivityStatuses with a pane hosted for another workspace', () => {
  const W1 = 'repo::/w1'
  const W2 = 'repo::/w2'
  const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'

  function hostedShellState(withHome: boolean): StatusState {
    return {
      ...makeStatusState(),
      tabsByWorktree: {
        [W1]: [],
        [W2]: [{ id: 'host-tab', title: 'zsh' }]
      } as unknown as StatusState['tabsByWorktree'],
      ptyIdsByTabId: { 'host-tab': ['pty-foreign'] },
      terminalLayoutsByTabId: {
        'host-tab': {
          root: { type: 'leaf', leafId: FOREIGN_LEAF },
          activeLeafId: FOREIGN_LEAF,
          expandedLeafId: null,
          ptyIdsByLeafId: { [FOREIGN_LEAF]: 'pty-foreign' },
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
  }

  it('given a live shell-only foreign pane then its home is active and the host is inactive', () => {
    const statuses = selectWorktreeActivityStatuses(hostedShellState(true), [W1, W2])

    expect(statuses.get(W1)).toBe('active')
    expect(statuses.get(W2)).toBe('inactive')
  })

  it('given the same pane without a home then the host is active as before', () => {
    const statuses = selectWorktreeActivityStatuses(hostedShellState(false), [W1, W2])

    expect(statuses.get(W1)).toBe('inactive')
    expect(statuses.get(W2)).toBe('active')
  })
})
