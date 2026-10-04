import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { getDefaultWorkspaceSession } from '../../shared/constants'

// A pane hosted in another workspace's tab is published with its home as the leaf's
// worktree while the tab keeps its host. Ownership (PTY record, terminal list) follows the leaf.

const HOST = 'repo-host::/tmp/foreign-leaf-host'
const HOME = 'repo-home::/tmp/foreign-leaf-home'
const TAB_ID = 'host-tab'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'
const NATIVE_PTY = 'pty-native'
const FOREIGN_PTY = 'pty-foreign'

function makeStore() {
  return {
    getWorkspaceSession: vi.fn(() => getDefaultWorkspaceSession()),
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

function ptyWorktreeId(runtime: OrcaRuntimeService, ptyId: string): string | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: ptysById is the runtime's protected PTY record map; this suite only reads it.
  return (runtime as unknown as { ptysById: Map<string, { worktreeId: string }> }).ptysById.get(
    ptyId
  )?.worktreeId
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
