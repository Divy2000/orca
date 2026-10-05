import { describe, expect, it } from 'vitest'
import {
  LEAF_ID,
  OTHER_WORKTREE_ID,
  PTY_ID,
  TAB_ID,
  WORKTREE_ID,
  createHarness,
  type CloseContinuityHarness
} from './__fixtures__/orca-runtime-terminal-close-continuity-fixtures'

const HOST_TAB_ID = 'host-tab'

/** The renderer graph after the pane moved into a tab of another workspace. */
function syncMovedPaneGraph(harness: CloseContinuityHarness): void {
  harness.runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: HOST_TAB_ID,
        worktreeId: OTHER_WORKTREE_ID,
        title: 'Host shell',
        activeLeafId: LEAF_ID,
        layout: { type: 'leaf', leafId: LEAF_ID }
      }
    ],
    leaves: [
      {
        tabId: HOST_TAB_ID,
        worktreeId: WORKTREE_ID,
        leafId: LEAF_ID,
        paneRuntimeId: 9,
        ptyId: PTY_ID
      }
    ]
  })
}

async function closeEmptiedSourceTab(harness: CloseContinuityHarness): Promise<void> {
  await harness.runtime.closeTerminalSurfaceFromRenderer({
    worktreeId: WORKTREE_ID,
    target: { kind: 'tab', tabId: TAB_ID },
    reason: 'cleanup'
  })
}

describe('closing the tab a live pane moved out of', () => {
  it.each([
    ['after the renderer graph shows the move', true],
    ['before the renderer graph shows the move', false]
  ])('given the renderer close %s then main does not stop the moved PTY', async (_, synced) => {
    const harness = createHarness({ registerPtyBacked: true })
    expect(harness.getSession().tabsByWorktree[WORKTREE_ID]?.map((tab) => tab.id)).toContain(TAB_ID)
    if (synced) {
      syncMovedPaneGraph(harness)
    }

    await closeEmptiedSourceTab(harness)

    expect(harness.kill).not.toHaveBeenCalled()
    expect(harness.stopAndWait).not.toHaveBeenCalled()
    expect(harness.closeTerminalTab).not.toHaveBeenCalled()
    expect(harness.getSession().tabsByWorktree[WORKTREE_ID]?.map((tab) => tab.id)).not.toContain(
      TAB_ID
    )
  })
})
