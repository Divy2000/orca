/**
 * A pane hosted in another workspace's tab publishes its home as the leaf's
 * worktree, so main records its PTY under the home; the tab keeps its host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeSyncWindowGraph } from '../../../shared/runtime-types'
import type { AppState } from '../store/types'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'

vi.mock('@/components/terminal-pane/pty-dispatcher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, getEagerPtyBufferHandle: vi.fn(() => undefined) }
})

import { getEagerPtyBufferHandle } from '@/components/terminal-pane/pty-dispatcher'
import {
  registerRuntimeTerminalTab,
  setRuntimeGraphStoreStateGetter,
  setRuntimeGraphSyncEnabled
} from './sync-runtime-graph'
import { makeState } from './sync-runtime-graph-test-harness'

const HOST = 'repo-1::/work/host'
const HOME = 'repo-1::/work/home'
const TAB_ID = 'host-tab'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'
const PTY_BY_LEAF: Record<string, string> = {
  [NATIVE_LEAF]: 'pty-native',
  [FOREIGN_LEAF]: 'pty-foreign'
}

function hostTab(): TerminalTab {
  return {
    id: TAB_ID,
    ptyId: 'pty-native',
    worktreeId: HOST,
    title: 'shell',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function hostState(): AppState {
  const layout: TerminalLayoutSnapshot = {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: NATIVE_LEAF },
      second: { type: 'leaf', leafId: FOREIGN_LEAF }
    },
    activeLeafId: NATIVE_LEAF,
    expandedLeafId: null,
    ptyIdsByLeafId: PTY_BY_LEAF,
    homeByLeafId: {
      [FOREIGN_LEAF]: { worktreeId: HOME, sessionTabId: 'home-tab', sessionLeafId: FOREIGN_LEAF }
    }
  }
  return makeState({
    tabsByWorktree: { [HOST]: [hostTab()] },
    terminalLayoutsByTabId: { [TAB_ID]: layout }
  })
}

function registerHostTab(): () => void {
  const panes = [NATIVE_LEAF, FOREIGN_LEAF].map((leafId, index) => ({
    id: index + 1,
    leafId,
    container: { querySelector: () => null }
  }))
  const manager = {
    getPanes: () => panes,
    getActivePane: () => panes[0],
    getLeafId: (paneId: number) => panes.find((pane) => pane.id === paneId)?.leafId ?? null,
    getNumericIdForLeaf: (leafId: string) => panes.find((pane) => pane.leafId === leafId)?.id
  }
  return registerRuntimeTerminalTab({
    tabId: TAB_ID,
    worktreeId: HOST,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: PaneManager has private fields and xterm/DOM-backed panes a node test cannot build; publication reads only the stubbed methods and pane id/leafId.
    getManager: () => manager as unknown as PaneManager,
    getContainer: () => null,
    getPtyIdForPane: (paneId) => PTY_BY_LEAF[panes[paneId - 1]?.leafId ?? ''] ?? null,
    getTabWideAgentHintLeafId: () => null
  })
}

async function captureGraph(): Promise<RuntimeSyncWindowGraph> {
  vi.useFakeTimers()
  const syncWindowGraph = vi
    .fn<(graph: RuntimeSyncWindowGraph) => Promise<void>>()
    .mockResolvedValue(undefined)
  vi.stubGlobal('window', { api: { runtime: { syncWindowGraph } } })
  vi.stubGlobal('HTMLElement', class HTMLElement {})
  setRuntimeGraphStoreStateGetter(hostState)
  setRuntimeGraphSyncEnabled(true)
  await vi.advanceTimersByTimeAsync(20)
  await Promise.resolve()
  expect(syncWindowGraph).toHaveBeenCalledTimes(1)
  const graph = syncWindowGraph.mock.calls[0]?.[0]
  if (!graph) {
    throw new Error('Expected syncWindowGraph to receive a runtime graph')
  }
  return graph
}

function leafWorktrees(graph: RuntimeSyncWindowGraph): Record<string, string> {
  return Object.fromEntries(graph.leaves.map((leaf) => [leaf.leafId, leaf.worktreeId]))
}

afterEach(() => {
  setRuntimeGraphSyncEnabled(false)
  setRuntimeGraphStoreStateGetter(null)
  vi.mocked(getEagerPtyBufferHandle).mockReturnValue(undefined)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('syncRuntimeGraph foreign leaves', () => {
  it('given a mounted host tab with a foreign pane then that leaf publishes its home', async () => {
    const unregister = registerHostTab()
    try {
      const graph = await captureGraph()

      expect(leafWorktrees(graph)).toEqual({ [NATIVE_LEAF]: HOST, [FOREIGN_LEAF]: HOME })
      expect(graph.tabs.find((tab) => tab.tabId === TAB_ID)?.worktreeId).toBe(HOST)
    } finally {
      unregister()
    }
  })

  it('given a parked host tab with a foreign pane then that leaf publishes its home', async () => {
    vi.mocked(getEagerPtyBufferHandle).mockReturnValue({ flush: () => '', dispose: vi.fn() })

    const graph = await captureGraph()

    expect(leafWorktrees(graph)).toEqual({ [NATIVE_LEAF]: HOST, [FOREIGN_LEAF]: HOME })
    expect(graph.tabs.find((tab) => tab.tabId === TAB_ID)?.worktreeId).toBe(HOST)
  })
})
