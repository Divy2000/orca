import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot, TerminalLeafHome } from '../../../shared/terminal-tab-types'
import { terminalLayoutEqual } from './terminal-layout-equality'

const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'

function home(overrides: Partial<TerminalLeafHome> = {}): TerminalLeafHome {
  return {
    worktreeId: 'repo-1::/work/foreign',
    sessionTabId: 'tab-home',
    sessionLeafId: LEAF_2,
    ...overrides
  }
}

function layout(homeByLeafId?: Record<string, TerminalLeafHome>): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: LEAF_1 },
      second: { type: 'leaf', leafId: LEAF_2 }
    },
    activeLeafId: LEAF_1,
    expandedLeafId: null,
    ...(homeByLeafId ? { homeByLeafId } : {})
  }
}

describe('terminalLayoutEqual leaf homes', () => {
  it('treats layouts with structurally identical home entries as equal', () => {
    expect(terminalLayoutEqual(layout({ [LEAF_2]: home() }), layout({ [LEAF_2]: home() }))).toBe(
      true
    )
  })

  it('treats a missing home map as equal to no home map', () => {
    expect(terminalLayoutEqual(layout(), layout())).toBe(true)
  })

  it('is not equal when only one layout carries a home entry', () => {
    expect(terminalLayoutEqual(layout(), layout({ [LEAF_2]: home() }))).toBe(false)
    expect(terminalLayoutEqual(layout({ [LEAF_2]: home() }), layout())).toBe(false)
  })

  it('is not equal when the same leaf names a different home workspace', () => {
    expect(
      terminalLayoutEqual(
        layout({ [LEAF_2]: home() }),
        layout({ [LEAF_2]: home({ worktreeId: 'repo-1::/work/other' }) })
      )
    ).toBe(false)
  })

  it.each([
    ['sessionTabId', { sessionTabId: 'tab-other' }],
    ['sessionLeafId', { sessionLeafId: LEAF_1 }],
    ['slot', { slot: { groupId: 'group-1', afterTabId: null } }],
    ['color', { color: '#fff' }],
    ['isPinned', { isPinned: true }]
  ] as const)('is not equal when only the home %s differs', (_field, overrides) => {
    expect(
      terminalLayoutEqual(layout({ [LEAF_2]: home() }), layout({ [LEAF_2]: home(overrides) }))
    ).toBe(false)
  })

  it('is not equal when the slot anchor differs', () => {
    const slot = (afterTabId: string | null): Partial<TerminalLeafHome> => ({
      slot: { groupId: 'group-1', afterTabId }
    })

    expect(
      terminalLayoutEqual(
        layout({ [LEAF_2]: home(slot('tab-a')) }),
        layout({ [LEAF_2]: home(slot(null)) })
      )
    ).toBe(false)
  })

  it('is not equal when home entries are keyed by different leaves', () => {
    expect(terminalLayoutEqual(layout({ [LEAF_1]: home() }), layout({ [LEAF_2]: home() }))).toBe(
      false
    )
  })
})
