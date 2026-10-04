import { describe, expect, it } from 'vitest'
import { getDefaultWorkspaceSession } from '../../../../shared/constants'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session-state-types'
import {
  buildValidWorktreeIdsForSessionHydration,
  collectPersistedWorktreeIdsForSessionHydration
} from './degraded-repo-worktree-validity'

const OWNER = 'repo1::/path/owner'
const HOME = 'repo1::/path/home'
const LEAF = '11111111-1111-4111-8111-111111111111'

function sessionWithHomedPane(): WorkspaceSessionState {
  return {
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: { [OWNER]: [] },
    terminalLayoutsByTabId: {
      'tab-1': {
        root: { type: 'leaf', leafId: LEAF },
        activeLeafId: LEAF,
        expandedLeafId: null,
        homeByLeafId: {
          [LEAF]: { worktreeId: HOME, sessionTabId: 'tab-home', sessionLeafId: LEAF }
        }
      }
    }
  }
}

describe('collectPersistedWorktreeIdsForSessionHydration', () => {
  it('includes the home workspace of a pane homed outside its tab workspace', () => {
    const ids = collectPersistedWorktreeIdsForSessionHydration(sessionWithHomedPane())

    expect(ids).toEqual(new Set([OWNER, HOME]))
  })

  it('adds nothing for layouts without home entries', () => {
    const session = sessionWithHomedPane()
    delete session.terminalLayoutsByTabId['tab-1']!.homeByLeafId

    expect(collectPersistedWorktreeIdsForSessionHydration(session)).toEqual(new Set([OWNER]))
  })
})

describe('buildValidWorktreeIdsForSessionHydration with homed panes', () => {
  it('keeps a home workspace valid while its repo has not loaded any worktrees', () => {
    const valid = buildValidWorktreeIdsForSessionHydration(
      { repos: [{ id: 'repo1' }], worktreesByRepo: {} },
      collectPersistedWorktreeIdsForSessionHydration(sessionWithHomedPane())
    )

    expect(valid.has(HOME)).toBe(true)
  })

  it('drops a home workspace that an authoritative listing no longer contains', () => {
    const valid = buildValidWorktreeIdsForSessionHydration(
      { repos: [{ id: 'repo1' }], worktreesByRepo: { repo1: [{ id: OWNER }] } },
      collectPersistedWorktreeIdsForSessionHydration(sessionWithHomedPane())
    )

    expect(valid.has(HOME)).toBe(false)
  })
})
