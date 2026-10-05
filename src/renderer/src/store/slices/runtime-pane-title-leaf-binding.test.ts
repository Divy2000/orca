import { describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/runtime/sync-runtime-graph', () => ({
  scheduleRuntimeGraphSync: vi.fn()
}))
vi.mock('@/components/terminal-pane/pty-transport', () => ({
  registerEagerPtyBuffer: vi.fn(),
  ensurePtyDispatcher: vi.fn(),
  unregisterPtyDataHandlers: vi.fn()
}))
vi.mock('@/components/terminal-pane/shutdown-buffer-captures', () => ({
  shutdownBufferCaptures: vi.fn()
}))

// @ts-expect-error -- minimal preload API stub for the slice's IPC writes
globalThis.window = { api: {} }

import { createTestStore, makeTab, makeWorktree, seedStore } from './store-test-helpers'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

function seededStore() {
  const store = createTestStore()
  seedStore(store, {
    worktreesByRepo: {
      repo1: [makeWorktree({ id: 'wt-1', repoId: 'repo1', path: '/path/wt-1' })]
    },
    tabsByWorktree: {
      'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
    }
  })
  return store
}

describe('runtime pane title leaf bindings', () => {
  it('records the leaf a pane title belongs to alongside the title', () => {
    const store = seededStore()

    store.getState().setRuntimePaneTitle('tab-1', 2, '⠋ Codex', LEAF_B)

    expect(store.getState().runtimePaneTitleLeafIdsByTabId).toEqual({ 'tab-1': { 2: LEAF_B } })
  })

  it('rebinds a pane id that now belongs to another leaf even when the title is unchanged', () => {
    const store = seededStore()
    store.getState().setRuntimePaneTitle('tab-1', 2, '⠋ Codex', LEAF_A)

    store.getState().setRuntimePaneTitle('tab-1', 2, '⠋ Codex', LEAF_B)

    expect(store.getState().runtimePaneTitleLeafIdsByTabId['tab-1']?.[2]).toBe(LEAF_B)
  })

  it('drops the binding when a title is written without a known leaf', () => {
    const store = seededStore()
    store.getState().setRuntimePaneTitle('tab-1', 2, '⠋ Codex', LEAF_B)

    store.getState().setRuntimePaneTitle('tab-1', 2, 'zsh')

    expect(store.getState().runtimePaneTitleLeafIdsByTabId['tab-1']).toBeUndefined()
  })

  it('drops the binding when the pane title is cleared', () => {
    const store = seededStore()
    store.getState().setRuntimePaneTitle('tab-1', 1, 'zsh', LEAF_A)
    store.getState().setRuntimePaneTitle('tab-1', 2, '⠋ Codex', LEAF_B)

    store.getState().clearRuntimePaneTitle('tab-1', 2)

    expect(store.getState().runtimePaneTitleLeafIdsByTabId).toEqual({ 'tab-1': { 1: LEAF_A } })
  })

  it('drops every binding of a closed tab', () => {
    const store = seededStore()
    store.getState().setRuntimePaneTitle('tab-1', 2, '⠋ Codex', LEAF_B)

    store.getState().closeTab('tab-1')

    expect(store.getState().runtimePaneTitleLeafIdsByTabId['tab-1']).toBeUndefined()
  })

  it('keeps the binding map identity when a title is rewritten for the same leaf', () => {
    const store = seededStore()
    store.getState().setRuntimePaneTitle('tab-1', 2, '⠋ Codex', LEAF_B)
    const before = store.getState().runtimePaneTitleLeafIdsByTabId

    store.getState().setRuntimePaneTitle('tab-1', 2, '✋ Codex', LEAF_B)

    expect(store.getState().runtimePaneTitleLeafIdsByTabId).toBe(before)
  })

  it('re-sorts when an agent title moves to another leaf without changing text', () => {
    const store = createTestStore()
    seedStore(store, {
      worktreesByRepo: {
        repo1: [makeWorktree({ id: 'wt-bg', repoId: 'repo1', path: '/path/wt-bg' })]
      },
      tabsByWorktree: { 'wt-bg': [makeTab({ id: 'tab-1', worktreeId: 'wt-bg' })] }
    })
    store.getState().setRuntimePaneTitle('tab-1', 2, '⠋ Codex', LEAF_A)
    const before = store.getState().sortEpoch

    store.getState().setRuntimePaneTitle('tab-1', 2, '⠋ Codex', LEAF_B)

    expect(store.getState().sortEpoch).toBeGreaterThan(before)
  })
})
