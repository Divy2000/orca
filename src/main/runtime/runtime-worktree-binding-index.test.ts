import { describe, expect, it } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import { makePaneKey } from '../../shared/stable-pane-id'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import {
  indexPersistedPtySurfaceBindings,
  indexPersistedPtyWorktreeBindings
} from './runtime-worktree-binding-index'

const HOST = 'repo::/tmp/host'
const HOME = 'repo::/tmp/home'
const TAB_ID = 'host-tab'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'

type ForeignLeafShape = 'split' | 'stale' | 'foreign-only'

function hostSessionWithForeignLeaf(shape: ForeignLeafShape = 'split'): WorkspaceSessionState {
  const nativeLeaf = { type: 'leaf' as const, leafId: NATIVE_LEAF }
  const foreignLeaf = { type: 'leaf' as const, leafId: FOREIGN_LEAF }
  const root =
    shape === 'split'
      ? {
          type: 'split' as const,
          direction: 'vertical' as const,
          first: nativeLeaf,
          second: foreignLeaf
        }
      : shape === 'stale'
        ? nativeLeaf
        : foreignLeaf
  const ptyIdsByLeafId: Record<string, string> =
    shape === 'foreign-only'
      ? { [FOREIGN_LEAF]: 'pty-foreign' }
      : { [NATIVE_LEAF]: 'pty-native', [FOREIGN_LEAF]: 'pty-foreign' }
  return {
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: {
      [HOST]: [
        {
          id: TAB_ID,
          ptyId: shape === 'foreign-only' ? 'pty-foreign' : 'pty-native',
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
        root,
        activeLeafId: root.type === 'leaf' ? root.leafId : NATIVE_LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId,
        homeByLeafId: {
          [FOREIGN_LEAF]: {
            worktreeId: HOME,
            sessionTabId: 'home-tab',
            sessionLeafId: FOREIGN_LEAF
          }
        }
      }
    }
  }
}

/** The foreign PTY back in its home tab, while the host tab keeps a stale off-tree record of it. */
function returnedHomeSession(): WorkspaceSessionState {
  const session = hostSessionWithForeignLeaf('stale')
  session.tabsByWorktree[HOME] = [
    {
      id: 'home-tab',
      ptyId: 'pty-foreign',
      worktreeId: HOME,
      title: '',
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: 0
    }
  ]
  session.terminalLayoutsByTabId['home-tab'] = {
    root: { type: 'leaf', leafId: FOREIGN_LEAF },
    activeLeafId: FOREIGN_LEAF,
    expandedLeafId: null,
    ptyIdsByLeafId: { [FOREIGN_LEAF]: 'pty-foreign' }
  }
  return session
}

describe('indexPersistedPtyWorktreeBindings', () => {
  it('binds a pane hosted from another workspace to its recorded home', () => {
    const index = indexPersistedPtyWorktreeBindings(hostSessionWithForeignLeaf())

    expect(index.get('pty-foreign')).toBe(HOME)
    expect(index.get('pty-native')).toBe(HOST)
  })

  it('ignores a home recorded for a leaf no longer in the layout', () => {
    const index = indexPersistedPtyWorktreeBindings(hostSessionWithForeignLeaf('stale'))

    expect(index.get('pty-foreign')).toBe(HOST)
  })

  it('leaves a PTY claimed by a native and a foreign leaf unbound', () => {
    const session = hostSessionWithForeignLeaf('split')
    const layout = session.terminalLayoutsByTabId[TAB_ID]!
    layout.ptyIdsByLeafId = { [NATIVE_LEAF]: 'pty-x', [FOREIGN_LEAF]: 'pty-x' }
    session.tabsByWorktree[HOST]![0]!.ptyId = 'pty-x'

    expect(indexPersistedPtyWorktreeBindings(session).has('pty-x')).toBe(false)
  })

  it('keeps a live foreign pane bound to its home despite a stale record for its PTY', () => {
    const session = hostSessionWithForeignLeaf('foreign-only')
    session.terminalLayoutsByTabId[TAB_ID]!.ptyIdsByLeafId = {
      [NATIVE_LEAF]: 'pty-foreign',
      [FOREIGN_LEAF]: 'pty-foreign'
    }

    expect(indexPersistedPtyWorktreeBindings(session).get('pty-foreign')).toBe(HOME)
  })

  it('binds a PTY returned home to its home tab over a stale record in the host tab', () => {
    const index = indexPersistedPtyWorktreeBindings(returnedHomeSession())

    expect(index.get('pty-foreign')).toBe(HOME)
    expect(index.get('pty-native')).toBe(HOST)
  })

  it('binds a foreign-only tab PTY to its home over the tab-level fallback', () => {
    const index = indexPersistedPtyWorktreeBindings(hostSessionWithForeignLeaf('foreign-only'))

    expect(index.get('pty-foreign')).toBe(HOME)
  })
})

describe('indexPersistedPtySurfaceBindings', () => {
  const HOST_FOREIGN_PANE = makePaneKey(TAB_ID, FOREIGN_LEAF)
  const HOST_NATIVE_PANE = makePaneKey(TAB_ID, NATIVE_LEAF)
  const HOME_PANE = makePaneKey('home-tab', FOREIGN_LEAF)

  it('binds a mounted foreign pane to its home worktree at the host pane it occupies', () => {
    const session = hostSessionWithForeignLeaf('split')
    session.terminalPtyIncarnationsByPaneKey = { [HOST_FOREIGN_PANE]: 'inc-foreign' }

    expect(indexPersistedPtySurfaceBindings(session).get('pty-foreign')).toEqual({
      worktreeId: HOME,
      tabId: TAB_ID,
      paneKey: HOST_FOREIGN_PANE,
      incarnationId: 'inc-foreign'
    })
  })

  it('binds a mounted pane over a stale off-tree record of its PTY in the same tab', () => {
    const session = hostSessionWithForeignLeaf('foreign-only')
    session.terminalLayoutsByTabId[TAB_ID]!.ptyIdsByLeafId = {
      [NATIVE_LEAF]: 'pty-foreign',
      [FOREIGN_LEAF]: 'pty-foreign'
    }
    session.terminalPtyIncarnationsByPaneKey = {
      [HOST_NATIVE_PANE]: 'inc-stale',
      [HOST_FOREIGN_PANE]: 'inc-foreign'
    }

    expect(indexPersistedPtySurfaceBindings(session).get('pty-foreign')).toEqual({
      worktreeId: HOME,
      tabId: TAB_ID,
      paneKey: HOST_FOREIGN_PANE,
      incarnationId: 'inc-foreign'
    })
  })

  it('binds a PTY returned home to its home pane over a stale record in the host tab', () => {
    const session = returnedHomeSession()
    session.terminalPtyIncarnationsByPaneKey = {
      [HOST_FOREIGN_PANE]: 'inc-stale',
      [HOME_PANE]: 'inc-home'
    }

    expect(indexPersistedPtySurfaceBindings(session).get('pty-foreign')).toEqual({
      worktreeId: HOME,
      tabId: 'home-tab',
      paneKey: HOME_PANE,
      incarnationId: 'inc-home'
    })
  })

  it('leaves a PTY two mounted panes claim unbound', () => {
    const session = hostSessionWithForeignLeaf('split')
    session.terminalLayoutsByTabId[TAB_ID]!.ptyIdsByLeafId = {
      [NATIVE_LEAF]: 'pty-x',
      [FOREIGN_LEAF]: 'pty-x'
    }
    session.terminalPtyIncarnationsByPaneKey = {
      [HOST_NATIVE_PANE]: 'inc-x',
      [HOST_FOREIGN_PANE]: 'inc-x'
    }

    expect(indexPersistedPtySurfaceBindings(session).has('pty-x')).toBe(false)
  })

  it('binds an off-tree record to its tab worktree when no mounted pane claims the PTY', () => {
    const session = hostSessionWithForeignLeaf('stale')
    session.terminalPtyIncarnationsByPaneKey = { [HOST_FOREIGN_PANE]: 'inc-stale' }

    expect(indexPersistedPtySurfaceBindings(session).get('pty-foreign')).toEqual({
      worktreeId: HOST,
      tabId: TAB_ID,
      paneKey: HOST_FOREIGN_PANE,
      incarnationId: 'inc-stale'
    })
  })
})
