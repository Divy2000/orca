import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState, getDefaultWorkspaceSession } from '../../../shared/constants'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { migrateWorktreeIdentity } from './worktree-identity-migration'

const OLD = 'repo::/old/path'
const NEW = 'repo::/new/path'
const LEAF = '11111111-1111-4111-8111-111111111111'

function sessionHostingPaneFrom(homeWorktreeId: string): WorkspaceSessionState {
  const layout: TerminalLayoutSnapshot = {
    root: { type: 'leaf', leafId: LEAF },
    activeLeafId: LEAF,
    expandedLeafId: null,
    homeByLeafId: { [LEAF]: { worktreeId: homeWorktreeId, sessionTabId: 't', sessionLeafId: LEAF } }
  }
  return { ...getDefaultWorkspaceSession(), terminalLayoutsByTabId: { 'host-tab': layout } }
}

describe('migrateWorktreeIdentity pane homes', () => {
  it('repoints a pane home in every persisted session when its home workspace is renamed', () => {
    const state = {
      ...getDefaultPersistedState('/tmp'),
      workspaceSession: sessionHostingPaneFrom(OLD),
      workspaceSessionsByHostId: { 'ssh:host': sessionHostingPaneFrom(OLD) }
    }

    expect(migrateWorktreeIdentity(state, OLD, NEW)).toBe(true)

    for (const session of [state.workspaceSession, state.workspaceSessionsByHostId['ssh:host']]) {
      expect(session?.terminalLayoutsByTabId['host-tab']?.homeByLeafId?.[LEAF]?.worktreeId).toBe(
        NEW
      )
    }
  })

  it('reports no change when no pane home names the renamed workspace', () => {
    const state = {
      ...getDefaultPersistedState('/tmp'),
      workspaceSession: sessionHostingPaneFrom('repo::/elsewhere')
    }

    expect(migrateWorktreeIdentity(state, OLD, NEW)).toBe(false)
  })
})
