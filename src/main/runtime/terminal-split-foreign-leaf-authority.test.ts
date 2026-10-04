import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import type { TerminalTab } from '../../shared/terminal-tab-types'

// A pane hosted in another workspace's tab is published with its home (W1) as the leaf's
// worktree while its tab stays in the host (W2). Splitting it must still find its source.

const HOST = 'repo-host::/tmp/split-foreign-host'
const HOME = 'repo-home::/tmp/split-foreign-home'
const TAB_ID = 'host-tab'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'
const NATIVE_PTY = 'pty-native'
const FOREIGN_PTY = 'pty-foreign'

type SplitAuthority = {
  persisted: boolean
  rendererMounted: boolean
  persistedWorktreeId: string | null
} | null

type RuntimeInternals = {
  resolveTerminalSplitSourceAuthority: (
    worktreeId: string,
    tabId: string,
    leafId: string,
    ptyId: string
  ) => SplitAuthority
}

function hostTab(): TerminalTab {
  return {
    id: TAB_ID,
    ptyId: null,
    worktreeId: HOST,
    title: '',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function session(ptyIdsByLeafId: Record<string, string>): WorkspaceSessionState {
  const next = getDefaultWorkspaceSession()
  next.tabsByWorktree = { [HOST]: [hostTab()] }
  next.terminalLayoutsByTabId = {
    [TAB_ID]: {
      root: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', leafId: NATIVE_LEAF },
        second: { type: 'leaf', leafId: FOREIGN_LEAF }
      },
      activeLeafId: NATIVE_LEAF,
      expandedLeafId: null,
      ptyIdsByLeafId,
      homeByLeafId: {
        [FOREIGN_LEAF]: { worktreeId: HOME, sessionTabId: 'home-tab', sessionLeafId: FOREIGN_LEAF }
      }
    }
  }
  return next
}

function makeRuntime(persisted: WorkspaceSessionState): RuntimeInternals {
  const repo = (id: string, path: string) => ({
    id,
    path,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 0
  })
  const store = {
    getWorkspaceSession: vi.fn(() => persisted),
    setWorkspaceSession: vi.fn(),
    getRepos: vi.fn(() => [
      repo('repo-host', '/tmp/split-foreign-host'),
      repo('repo-home', '/tmp/split-foreign-home')
    ]),
    getAllWorktreeMeta: vi.fn(() => ({})),
    getWorktreeMeta: vi.fn(() => undefined),
    setWorktreeMeta: vi.fn(),
    removeWorktreeMeta: vi.fn(),
    getSettings: vi.fn(() => ({ workspaceDir: '/tmp/workspaces' })),
    getProjects: vi.fn(() => [])
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub covers the repo and session reads split authority makes.
  const runtime = new OrcaRuntimeService(store as never)
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, {
    tabs: [{ tabId: TAB_ID, worktreeId: HOST, title: '', activeLeafId: NATIVE_LEAF, layout: null }],
    leaves: [
      { tabId: TAB_ID, worktreeId: HOST, leafId: NATIVE_LEAF, paneRuntimeId: 1, ptyId: NATIVE_PTY },
      {
        tabId: TAB_ID,
        worktreeId: HOME,
        leafId: FOREIGN_LEAF,
        paneRuntimeId: 2,
        ptyId: FOREIGN_PTY
      }
    ]
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver is protected; this suite only calls it.
  return runtime as unknown as RuntimeInternals
}

const BOTH_BOUND = { [NATIVE_LEAF]: NATIVE_PTY, [FOREIGN_LEAF]: FOREIGN_PTY }

describe('split source authority for a leaf hosted in another workspace tab', () => {
  it('given a persisted foreign leaf then it resolves against the host tab', () => {
    const internals = makeRuntime(session(BOTH_BOUND))

    expect(
      internals.resolveTerminalSplitSourceAuthority(HOME, TAB_ID, FOREIGN_LEAF, FOREIGN_PTY)
    ).toMatchObject({ persisted: true, rendererMounted: true, persistedWorktreeId: HOST })
  })

  it('given a native leaf of the same tab then it resolves as before', () => {
    const internals = makeRuntime(session(BOTH_BOUND))

    expect(
      internals.resolveTerminalSplitSourceAuthority(HOST, TAB_ID, NATIVE_LEAF, NATIVE_PTY)
    ).toMatchObject({ persisted: true, rendererMounted: true, persistedWorktreeId: HOST })
  })

  it('given a foreign leaf whose binding is not persisted then it is refused', () => {
    const internals = makeRuntime(session({ [NATIVE_LEAF]: NATIVE_PTY }))

    expect(
      internals.resolveTerminalSplitSourceAuthority(HOME, TAB_ID, FOREIGN_LEAF, FOREIGN_PTY)
    ).toBeNull()
  })
})
