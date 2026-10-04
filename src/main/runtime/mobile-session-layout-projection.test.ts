import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../shared/terminal-tab-types'
import { cloneTerminalLayoutSnapshot } from './mobile-session-layout-projection'

const LEAF = '11111111-1111-4111-8111-111111111111'

function layout(extra: Partial<TerminalLayoutSnapshot> = {}): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId: LEAF },
    activeLeafId: LEAF,
    expandedLeafId: null,
    ...extra
  }
}

describe('cloneTerminalLayoutSnapshot', () => {
  it('copies leaf home entries into a new map', () => {
    const home = { worktreeId: 'wt-foreign', sessionTabId: 'tab-home', sessionLeafId: LEAF }
    const source = layout({ homeByLeafId: { [LEAF]: home } })

    const cloned = cloneTerminalLayoutSnapshot(source)

    expect(cloned.homeByLeafId).toEqual({ [LEAF]: home })
    expect(cloned.homeByLeafId).not.toBe(source.homeByLeafId)
  })

  it('does not add a home map when the source has none', () => {
    expect(Object.hasOwn(cloneTerminalLayoutSnapshot(layout()), 'homeByLeafId')).toBe(false)
  })
})
