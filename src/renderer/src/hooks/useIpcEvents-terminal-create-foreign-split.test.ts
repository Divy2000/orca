import { describe, expect, it } from 'vitest'
import { setupTerminalCreateSurfacing } from './ipc-events-terminal-create-test-harness'

const SOURCE_LEAF = '22222222-2222-4222-8222-222222222222'
const NEW_LEAF = '33333333-3333-4333-8333-333333333333'
const sourceHome = { worktreeId: 'wt-1', sessionTabId: 'home-tab', sessionLeafId: SOURCE_LEAF }

describe('runtime split reveal of a pane hosted for another workspace', () => {
  it('given a split named by the source home then it lands in the host tab and inherits the home', async () => {
    const scenario = await setupTerminalCreateSurfacing(() => false)
    const { storeState, createTerminalListenerRef, createTab, replyTerminalCreate } = scenario
    const { dispatchEvent } = scenario
    if (!createTerminalListenerRef.current) {
      throw new Error('Expected the create-terminal listener to be registered')
    }
    storeState.tabsByWorktree = {
      'wt-2': [{ id: 'host-tab', ptyId: 'pty-source', title: 'Terminal 1' }]
    }
    storeState.terminalLayoutsByTabId = {
      'host-tab': {
        root: { type: 'leaf', leafId: SOURCE_LEAF },
        activeLeafId: SOURCE_LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: { [SOURCE_LEAF]: 'pty-source' },
        homeByLeafId: { [SOURCE_LEAF]: sourceHome }
      }
    }

    createTerminalListenerRef.current({
      requestId: 'req-foreign-split',
      worktreeId: 'wt-1',
      ptyId: 'pty-split',
      tabId: 'host-tab',
      leafId: NEW_LEAF,
      splitFromLeafId: SOURCE_LEAF,
      splitDirection: 'vertical',
      activate: false
    })

    expect(createTab).not.toHaveBeenCalled()
    expect(replyTerminalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-foreign-split', tabId: 'host-tab' })
    )
    const layout = storeState.terminalLayoutsByTabId['host-tab']
    expect(layout).toHaveProperty(['ptyIdsByLeafId', NEW_LEAF], 'pty-split')
    expect(layout).toHaveProperty(['homeByLeafId', NEW_LEAF], {
      ...sourceHome,
      sessionLeafId: NEW_LEAF
    })
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'orca-split-terminal-pane',
        detail: expect.objectContaining({ worktreeId: 'wt-2', homeWorktreeId: 'wt-1' })
      })
    )
  })
})
