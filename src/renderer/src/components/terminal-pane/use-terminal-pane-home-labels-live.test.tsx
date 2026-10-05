// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { readStoreListenerCount } from '@/store/store-listener-census'
import { useTerminalPaneHomeLabels } from './use-terminal-pane-home-labels'
import {
  LEAF_MOVED,
  LEAF_TARGET,
  WT_A,
  WT_B,
  createMoveTestStore,
  pairLayout
} from './terminal-pane-move-test-fixture'
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const originalState = useAppStore.getState()
let root: Root | null = null
let container: HTMLDivElement | null = null
let seen: Readonly<Record<string, string>> = {}

function Probe(): null {
  seen = useTerminalPaneHomeLabels('tab-b', WT_B)
  return null
}

function seedHostedPane(): void {
  const fixture = createMoveTestStore([]).getState()
  useAppStore.setState({
    repos: fixture.repos,
    worktreesByRepo: fixture.worktreesByRepo,
    terminalLayoutsByTabId: {
      'tab-b': {
        ...pairLayout([LEAF_TARGET, 'pty-target'], [LEAF_MOVED, 'pty-moved']),
        homeByLeafId: {
          [LEAF_MOVED]: { worktreeId: WT_A, sessionTabId: 't', sessionLeafId: LEAF_MOVED }
        }
      }
    }
  })
}

function renameHome(displayName: string | null): void {
  const worktrees = useAppStore.getState().worktreesByRepo.repo1 ?? []
  act(() =>
    useAppStore.setState({
      worktreesByRepo: {
        repo1:
          displayName === null
            ? worktrees.filter((worktree) => worktree.id !== WT_A)
            : worktrees.map((worktree) =>
                worktree.id === WT_A ? { ...worktree, displayName } : worktree
              )
      }
    })
  )
}

function listenerCount(): number {
  const count = readStoreListenerCount()
  if (count === null) {
    throw new Error('store listener census unavailable')
  }
  return count
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  root = null
  container?.remove()
  container = null
  useAppStore.setState(originalState, true)
})

describe('useTerminalPaneHomeLabels', () => {
  it('follows the home workspace being renamed and deleted with a single store listener', () => {
    seedHostedPane()
    const baseline = listenerCount()
    container = document.createElement('div')
    root = createRoot(container)
    act(() => root?.render(<Probe />))

    expect(listenerCount() - baseline).toBe(1)
    expect(seen).toEqual({ [LEAF_MOVED]: WT_A })

    renameHome('login-flow')
    expect(seen).toEqual({ [LEAF_MOVED]: 'login-flow' })

    renameHome(null)
    expect(seen).toEqual({})
  })
})
