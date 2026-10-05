import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgentHibernationTick } from './agent-hibernation-coordinator'
import {
  entry,
  installEligibleState,
  layout,
  LEAF,
  resetAgentHibernationCoordinatorFixture
} from './agent-hibernation-coordinator-test-fixture'

afterEach(resetAgentHibernationCoordinatorFixture)

describe('agent sleep coordinator for a pane hosted in another workspace tab', () => {
  it('given a completed foreign agent then shutdown addresses the host tab and names the home', async () => {
    const home = { worktreeId: 'wt-home', sessionTabId: 'home-tab', sessionLeafId: LEAF }
    const shutdown = installEligibleState(vi.fn().mockResolvedValue(undefined), {
      terminalLayoutsByTabId: { 'tab-1': { ...layout(), homeByLeafId: { [LEAF]: home } } },
      agentStatusByPaneKey: { [`tab-1:${LEAF}`]: { ...entry(), worktreeId: 'wt-home' } }
    })

    await runAgentHibernationTick()
    await runAgentHibernationTick()

    expect(shutdown).toHaveBeenCalledWith('wt-bg', {
      paneKey: `tab-1:${LEAF}`,
      tabId: 'tab-1',
      leafId: LEAF,
      ptyId: 'pty-1',
      homeWorktreeId: 'wt-home'
    })
  })
})
