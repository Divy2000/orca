import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/terminal-tab-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { buildWorktreeAgentRows } from './worktree-agent-rows'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

const tab: TerminalTab = {
  id: 'tab-1',
  worktreeId: 'wt-1',
  ptyId: 'pty-a',
  title: 'zsh',
  customTitle: null,
  color: null,
  sortOrder: 0,
  createdAt: 0
}

const layout: TerminalLayoutSnapshot = {
  root: {
    type: 'split',
    direction: 'vertical',
    first: { type: 'leaf', leafId: LEAF_A },
    second: { type: 'leaf', leafId: LEAF_B }
  },
  activeLeafId: LEAF_A,
  expandedLeafId: null,
  ptyIdsByLeafId: { [LEAF_A]: 'pty-a', [LEAF_B]: 'pty-b' }
}

describe('title-derived agent rows with recorded title leaves', () => {
  it('given a title recorded for the second leaf then its row names that leaf', () => {
    const rows = buildWorktreeAgentRows({
      tabs: [tab],
      entries: [],
      retained: [],
      runtimePaneTitlesByTabId: { 'tab-1': { 1: '⠋ Claude Code' } },
      runtimePaneTitleLeafIdsByTabId: { 'tab-1': { 1: LEAF_B } },
      ptyIdsByTabId: { 'tab-1': ['pty-a', 'pty-b'] },
      terminalLayoutsByTabId: { 'tab-1': layout },
      now: 1_000
    })

    expect(rows.map((row) => row.paneKey)).toEqual([makePaneKey('tab-1', LEAF_B)])
  })
})
