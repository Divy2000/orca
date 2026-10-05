import { describe, expect, it } from 'vitest'
import type {
  TerminalLayoutSnapshot,
  TerminalLeafHome,
  TerminalTab
} from '../../../../shared/terminal-tab-types'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session-state-types'
import { buildWorkspaceTerminalLayoutPlan } from './workspace-terminal-layout-plan'

const OWNER = 'repo-1::/work/owner'
const HOME = 'repo-1::/work/home'
const DELETED = 'repo-1::/work/deleted'
const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'

function tab(): TerminalTab {
  return {
    id: 'tab-1',
    ptyId: null,
    worktreeId: OWNER,
    title: 'Terminal 1',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function home(worktreeId: string): TerminalLeafHome {
  return { worktreeId, sessionTabId: 'tab-home', sessionLeafId: LEAF_2 }
}

function layout(homeByLeafId?: Record<string, TerminalLeafHome>): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: LEAF_1 },
      second: { type: 'leaf', leafId: LEAF_2 }
    },
    activeLeafId: LEAF_1,
    expandedLeafId: null,
    ptyIdsByLeafId: { [LEAF_1]: 'pty-1', [LEAF_2]: 'pty-2' },
    ...(homeByLeafId ? { homeByLeafId } : {})
  }
}

function plan(persisted: TerminalLayoutSnapshot, validWorktreeIds: ReadonlySet<string>) {
  const session = {
    activeRepoId: null,
    activeWorktreeId: null,
    activeTabId: null,
    tabsByWorktree: { [OWNER]: [tab()] },
    terminalLayoutsByTabId: { 'tab-1': persisted }
  } satisfies WorkspaceSessionState
  return buildWorkspaceTerminalLayoutPlan({
    ownershipTransfersByTabId: new Map(),
    ownershipTransferTabIds: null,
    releasedPtyIdsByTabId: new Map(),
    session,
    tabById: new Map([['tab-1', tab()]]),
    validTabIds: new Set(['tab-1']),
    validWorktreeIds
  })['tab-1']!
}

describe('buildWorkspaceTerminalLayoutPlan leaf homes', () => {
  it('keeps a home entry whose home workspace still exists', () => {
    const restored = plan(layout({ [LEAF_2]: home(HOME) }), new Set([OWNER, HOME]))

    expect(restored.homeByLeafId).toEqual({ [LEAF_2]: home(HOME) })
  })

  it('makes a pane native when its home workspace was deleted, keeping its process binding', () => {
    const restored = plan(layout({ [LEAF_2]: home(DELETED) }), new Set([OWNER]))

    expect(restored.homeByLeafId).toBeUndefined()
    expect(restored.ptyIdsByLeafId).toEqual({ [LEAF_1]: 'pty-1', [LEAF_2]: 'pty-2' })
  })

  it('drops only the entries whose home workspace was deleted', () => {
    const restored = plan(
      layout({ [LEAF_1]: home(HOME), [LEAF_2]: home(DELETED) }),
      new Set([OWNER, HOME])
    )

    expect(restored.homeByLeafId).toEqual({ [LEAF_1]: home(HOME) })
  })

  it('drops an entry that names the tab own workspace', () => {
    const restored = plan(layout({ [LEAF_2]: home(OWNER) }), new Set([OWNER]))

    expect(restored.homeByLeafId).toBeUndefined()
  })

  it('does not add a home map to an unmixed layout', () => {
    const restored = plan(layout(), new Set([OWNER]))

    expect(Object.hasOwn(restored, 'homeByLeafId')).toBe(false)
  })
})
