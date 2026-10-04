import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'

// A pane hosted in another workspace's tab is published with its home as the leaf's
// worktree while the tab keeps its host. Ownership (PTY record, terminal list) follows the leaf.

const HOST = 'repo-host::/tmp/foreign-leaf-host'
const HOME = 'repo-home::/tmp/foreign-leaf-home'
const TAB_ID = 'host-tab'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'
const NATIVE_PTY = 'pty-native'
const FOREIGN_PTY = 'pty-foreign'

function makeStore(sessionOverrides: Partial<WorkspaceSessionState> = {}) {
  return {
    getWorkspaceSession: vi.fn(() => ({ ...getDefaultWorkspaceSession(), ...sessionOverrides })),
    setWorkspaceSession: vi.fn(),
    getRepos: vi.fn(() => [
      {
        id: 'repo-host',
        path: '/tmp/foreign-leaf-host',
        displayName: 'host',
        badgeColor: '#000000',
        addedAt: 0
      },
      {
        id: 'repo-home',
        path: '/tmp/foreign-leaf-home',
        displayName: 'home',
        badgeColor: '#000000',
        addedAt: 0
      }
    ]),
    getAllWorktreeMeta: vi.fn(() => ({})),
    getWorktreeMeta: vi.fn(() => undefined),
    setWorktreeMeta: vi.fn(),
    removeWorktreeMeta: vi.fn(),
    getSettings: vi.fn(() => ({ workspaceDir: '/tmp/workspaces' })),
    getProjects: vi.fn(() => [])
  }
}

function leaf(leafId: string, ptyId: string, worktreeId: string, paneRuntimeId: number) {
  return { tabId: TAB_ID, worktreeId, leafId, paneRuntimeId, ptyId, paneTitle: null, title: '' }
}

function makeRuntime(foreignLeafWorktreeId: string): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: makeStore returns the repo and session reads this suite drives; the rest of Store is unreached.
  const runtime = new OrcaRuntimeService(makeStore() as never)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub carries the controller members terminal listing reads; both PTYs stay live.
  runtime.setPtyController({
    spawn: vi.fn(async () => ({ id: 'never' })),
    write: () => true,
    kill: () => true,
    listProcesses: vi.fn(async () => [])
  } as never)
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, {
    tabs: [{ tabId: TAB_ID, worktreeId: HOST, title: '', activeLeafId: NATIVE_LEAF, layout: null }],
    leaves: [
      leaf(NATIVE_LEAF, NATIVE_PTY, HOST, 1),
      leaf(FOREIGN_LEAF, FOREIGN_PTY, foreignLeafWorktreeId, 2)
    ]
  })
  return runtime
}

type PtyRecordView = { worktreeId: string; tabId?: string | null; paneKey?: string | null }

function ptyRecord(runtime: OrcaRuntimeService, ptyId: string): PtyRecordView | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: ptysById is the runtime's protected PTY record map; this suite only reads it.
  const records = (runtime as unknown as { ptysById: Map<string, PtyRecordView> }).ptysById
  return records.get(ptyId)
}

function ptyWorktreeId(runtime: OrcaRuntimeService, ptyId: string): string | undefined {
  return ptyRecord(runtime, ptyId)?.worktreeId
}

async function listedPtyIds(runtime: OrcaRuntimeService, worktreeId: string): Promise<string[]> {
  const { terminals } = await runtime.listTerminals(`id:${worktreeId}`)
  return terminals.flatMap((terminal) => (terminal.ptyId ? [terminal.ptyId] : [])).sort()
}

describe('terminal ownership for a leaf whose worktree differs from its tab', () => {
  it('records the PTY under the leaf worktree, not the tab worktree', () => {
    const runtime = makeRuntime(HOME)

    expect(ptyWorktreeId(runtime, FOREIGN_PTY)).toBe(HOME)
    expect(ptyWorktreeId(runtime, NATIVE_PTY)).toBe(HOST)
  })

  it('lists the foreign terminal under its home and not under its host', async () => {
    const runtime = makeRuntime(HOME)

    expect(await listedPtyIds(runtime, HOME)).toEqual([FOREIGN_PTY])
    expect(await listedPtyIds(runtime, HOST)).toEqual([NATIVE_PTY])
  })

  it('lists both terminals under the host when every leaf names the tab worktree', async () => {
    const runtime = makeRuntime(HOST)

    expect(await listedPtyIds(runtime, HOST)).toEqual([NATIVE_PTY, FOREIGN_PTY].sort())
    expect(await listedPtyIds(runtime, HOME)).toEqual([])
  })
})

type PersistedForeignLeaf = 'attested' | 'home-removed' | 'other-pty' | 'leaf-not-in-layout'

/** The host's persisted session: the host tab, and what its layout records for the foreign leaf. */
function persistedHostSession(foreignLeaf: PersistedForeignLeaf): Partial<WorkspaceSessionState> {
  return {
    terminalTopologyRevisionByRepoId: { 'repo-host': 1, 'repo-home': 1 },
    tabsByWorktree: {
      [HOST]: [
        {
          id: TAB_ID,
          ptyId: NATIVE_PTY,
          worktreeId: HOST,
          title: '',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 0
        }
      ]
    },
    terminalLayoutsByTabId: {
      [TAB_ID]: {
        root:
          foreignLeaf === 'leaf-not-in-layout'
            ? { type: 'leaf', leafId: NATIVE_LEAF }
            : {
                type: 'split',
                direction: 'vertical',
                first: { type: 'leaf', leafId: NATIVE_LEAF },
                second: { type: 'leaf', leafId: FOREIGN_LEAF }
              },
        activeLeafId: NATIVE_LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: {
          [NATIVE_LEAF]: NATIVE_PTY,
          [FOREIGN_LEAF]: foreignLeaf === 'other-pty' ? 'pty-other' : FOREIGN_PTY
        },
        ...(foreignLeaf === 'home-removed'
          ? {}
          : {
              homeByLeafId: {
                [FOREIGN_LEAF]: {
                  worktreeId: HOME,
                  sessionTabId: 'home-tab',
                  sessionLeafId: FOREIGN_LEAF
                }
              }
            })
      }
    }
  }
}

describe('a foreign leaf whose PTY the host pane registered', () => {
  // Reattaching from the host tab registers the PTY under the tab's worktree; once the repo's
  // terminal membership is host-authoritative, the leaf is published only if the host attests it.
  function makeAuthoritativeRuntime(foreignLeaf: PersistedForeignLeaf): OrcaRuntimeService {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: makeStore returns the repo and session reads this suite drives; the rest of Store is unreached.
    const runtime = new OrcaRuntimeService(makeStore(persistedHostSession(foreignLeaf)) as never)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub carries the controller members terminal listing reads; both PTYs stay live.
    runtime.setPtyController({
      spawn: vi.fn(async () => ({ id: 'never' })),
      write: () => true,
      kill: () => true,
      // Both PTYs stay live in the provider inventory, so a dropped leaf would surface as a stray PTY.
      listProcesses: vi.fn(async () => [
        { id: NATIVE_PTY, cwd: '', title: '' },
        { id: FOREIGN_PTY, cwd: '', title: '' }
      ])
    } as never)
    runtime.attachWindow(1)
    runtime.registerPty(NATIVE_PTY, HOST, null, { tabId: TAB_ID, leafId: NATIVE_LEAF })
    runtime.registerPty(FOREIGN_PTY, HOST, null, { tabId: TAB_ID, leafId: FOREIGN_LEAF })
    runtime.syncWindowGraph(1, {
      tabs: [
        { tabId: TAB_ID, worktreeId: HOST, title: '', activeLeafId: NATIVE_LEAF, layout: null }
      ],
      leaves: [leaf(NATIVE_LEAF, NATIVE_PTY, HOST, 1), leaf(FOREIGN_LEAF, FOREIGN_PTY, HOME, 2)]
    })
    return runtime
  }

  it('lists the foreign terminal as its leaf under its home', async () => {
    const runtime = makeAuthoritativeRuntime('attested')

    const { terminals } = await runtime.listTerminals(`id:${HOME}`)

    expect(
      terminals.map((terminal) => ({
        ptyId: terminal.ptyId,
        tabId: terminal.tabId,
        leafId: terminal.leafId
      }))
    ).toEqual([{ ptyId: FOREIGN_PTY, tabId: TAB_ID, leafId: FOREIGN_LEAF }])
    expect(ptyWorktreeId(runtime, FOREIGN_PTY)).toBe(HOME)
  })

  it('keeps the foreign terminal out of the host listing', async () => {
    const runtime = makeAuthoritativeRuntime('attested')

    expect(await listedPtyIds(runtime, HOST)).toEqual([NATIVE_PTY])
  })

  it.each([
    ['records no home for the leaf', 'home-removed'],
    ['binds the leaf to another PTY', 'other-pty'],
    ['keeps a stale home for a leaf it no longer contains', 'leaf-not-in-layout']
  ] as const)(
    'does not hand the PTY to the claimed home when the host layout %s',
    async (_description, foreignLeaf) => {
      const runtime = makeAuthoritativeRuntime(foreignLeaf)

      expect(ptyWorktreeId(runtime, FOREIGN_PTY)).toBe(HOST)
      expect(
        (await runtime.listTerminals(`id:${HOME}`)).terminals.map((terminal) => terminal.leafId)
      ).not.toContain(FOREIGN_LEAF)
    }
  )
})

describe('restoring a mounted foreign pane from the controller inventory', () => {
  // After a restart, before any graph is published, the PTY record is rebuilt from the
  // controller inventory and the persisted session. The foreign pane lives in the host tab
  // but belongs to its home, and its pane identity must survive that rebuild.
  it('restores the host pane identity under the home worktree', async () => {
    const session: Partial<WorkspaceSessionState> = {
      ...persistedHostSession('attested'),
      terminalPtyIncarnationsByPaneKey: { [`${TAB_ID}:${FOREIGN_LEAF}`]: 'inc-foreign' }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: makeStore returns the repo and session reads this suite drives; the rest of Store is unreached.
    const runtime = new OrcaRuntimeService(makeStore(session) as never)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub carries the controller members inventory recovery reads; the foreign PTY stays live.
    runtime.setPtyController({
      spawn: vi.fn(async () => ({ id: 'never' })),
      write: () => true,
      kill: () => true,
      listProcesses: vi.fn(async () => [
        { id: FOREIGN_PTY, cwd: '', title: '', incarnationId: 'inc-foreign' }
      ])
    } as never)

    await runtime.listTerminals(`id:${HOME}`)

    const record = ptyRecord(runtime, FOREIGN_PTY)
    expect({
      worktreeId: record?.worktreeId,
      tabId: record?.tabId,
      paneKey: record?.paneKey
    }).toEqual({ worktreeId: HOME, tabId: TAB_ID, paneKey: `${TAB_ID}:${FOREIGN_LEAF}` })
  })
})
