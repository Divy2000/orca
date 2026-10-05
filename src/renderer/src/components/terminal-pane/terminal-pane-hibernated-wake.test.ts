import { describe, expect, it, vi } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { wakeHibernatedPanesForWorktree } from './terminal-pane-hibernated-wake'

const W1 = 'repo-1::/work/w1'
const W2 = 'repo-1::/work/w2'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'

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

function setup() {
  const native = { dispose: vi.fn(), wakeHibernatedAgentIfArmed: vi.fn(() => 'claim-native') }
  const foreign = { dispose: vi.fn(), wakeHibernatedAgentIfArmed: vi.fn(() => 'claim-foreign') }
  const bindings = new Map([
    [1, native],
    [2, foreign]
  ])
  const leafIdByPaneId = new Map([
    [1, NATIVE_LEAF],
    [2, FOREIGN_LEAF]
  ])
  return {
    native,
    foreign,
    run: (worktreeId: string, wokenClaimKeys = new Set<string>()) => {
      wakeHibernatedPanesForWorktree({
        detail: { worktreeId, wokenClaimKeys },
        tabWorktreeId: W2,
        layout: hostLayout,
        getLeafId: (paneId) => leafIdByPaneId.get(paneId) ?? null,
        bindings
      })
      return wokenClaimKeys
    }
  }
}

describe('wakeHibernatedPanesForWorktree', () => {
  it('given a wake for the home then the foreign pane hosted in another tab wakes', () => {
    const { native, foreign, run } = setup()

    expect(run(W1)).toEqual(new Set(['claim-foreign']))
    expect(foreign.wakeHibernatedAgentIfArmed).toHaveBeenCalledOnce()
    expect(native.wakeHibernatedAgentIfArmed).not.toHaveBeenCalled()
  })

  it('given a wake for the host then only its native panes wake', () => {
    const { native, foreign, run } = setup()

    expect(run(W2)).toEqual(new Set(['claim-native']))
    expect(native.wakeHibernatedAgentIfArmed).toHaveBeenCalledOnce()
    expect(foreign.wakeHibernatedAgentIfArmed).not.toHaveBeenCalled()
  })

  it('given a wake for an unrelated workspace then nothing wakes', () => {
    const { native, foreign, run } = setup()

    run('repo-1::/work/other')

    expect(native.wakeHibernatedAgentIfArmed).not.toHaveBeenCalled()
    expect(foreign.wakeHibernatedAgentIfArmed).not.toHaveBeenCalled()
  })
})
