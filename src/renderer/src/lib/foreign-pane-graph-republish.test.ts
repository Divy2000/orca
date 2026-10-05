import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSessionPatch } from '../../../shared/workspace-session-state-types'
import { republishGraphAfterForeignPaneSessionWrite } from './foreign-pane-graph-republish'

const LEAF = '22222222-2222-4222-8222-222222222222'

function layoutPatch(withHome: boolean): WorkspaceSessionPatch {
  return {
    terminalLayoutsByTabId: {
      'host-tab': {
        root: { type: 'leaf', leafId: LEAF },
        activeLeafId: LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF]: 'pty-foreign' },
        ...(withHome
          ? {
              homeByLeafId: {
                [LEAF]: {
                  worktreeId: 'repo::/tmp/home',
                  sessionTabId: 'home-tab',
                  sessionLeafId: LEAF
                }
              }
            }
          : {})
      }
    }
  }
}

describe('republishGraphAfterForeignPaneSessionWrite', () => {
  it('republishes the runtime graph once a write carrying a foreign pane has landed', async () => {
    let landWrite: () => void = () => {}
    const write = new Promise<void>((resolve) => {
      landWrite = resolve
    })
    const schedule = vi.fn()

    republishGraphAfterForeignPaneSessionWrite(layoutPatch(true), write, schedule)
    await Promise.resolve()
    expect(schedule).not.toHaveBeenCalled()

    landWrite()
    await write
    await Promise.resolve()
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('leaves the graph alone for writes without foreign panes', async () => {
    const schedule = vi.fn()

    republishGraphAfterForeignPaneSessionWrite(layoutPatch(false), Promise.resolve(), schedule)
    republishGraphAfterForeignPaneSessionWrite({ activeTabId: 'tab' }, Promise.resolve(), schedule)
    await Promise.resolve()
    await Promise.resolve()

    expect(schedule).not.toHaveBeenCalled()
  })

  it('does not republish when the write fails', async () => {
    const schedule = vi.fn()

    republishGraphAfterForeignPaneSessionWrite(
      layoutPatch(true),
      Promise.reject(new Error('disk full')),
      schedule
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(schedule).not.toHaveBeenCalled()
  })
})
