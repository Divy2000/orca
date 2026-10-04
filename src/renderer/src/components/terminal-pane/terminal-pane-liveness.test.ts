import { describe, expect, it } from 'vitest'
import { isLiveTerminalPaneKey } from './terminal-pane-liveness'
import {
  createMoveTestStore,
  LEAF_MOVED,
  LEAF_SIBLING,
  leafLayout,
  WT_A
} from './terminal-pane-move-test-fixture'

describe('isLiveTerminalPaneKey', () => {
  const store = createMoveTestStore([
    { id: 'tab-a', worktreeId: WT_A, layout: leafLayout(LEAF_SIBLING, 'pty') }
  ])

  it('given a pane still in its tab’s layout, it is live', () => {
    expect(isLiveTerminalPaneKey(store.getState(), `tab-a:${LEAF_SIBLING}`)).toBe(true)
  })

  it.each([
    ['a leaf no longer in the layout', `tab-a:${LEAF_MOVED}`],
    ['a closed tab', `tab-gone:${LEAF_SIBLING}`],
    ['a malformed key', 'tab-a:leaf']
  ])('given %s, it is not live', (_label, paneKey) => {
    expect(isLiveTerminalPaneKey(store.getState(), paneKey)).toBe(false)
  })
})
