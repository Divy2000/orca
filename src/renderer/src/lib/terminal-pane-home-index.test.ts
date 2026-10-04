import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot, TerminalLeafHome } from '../../../shared/terminal-tab-types'
import {
  buildTerminalPaneHomeIndex,
  resolvePaneNavigationWorktreeId,
  selectHomedTerminalLayouts
} from './terminal-pane-home-index'

const HOST = 'repo-1::/work/host'
const HOME = 'repo-1::/work/home'
const LEAF_NATIVE = '11111111-1111-4111-8111-111111111111'
const LEAF_FOREIGN = '22222222-2222-4222-8222-222222222222'

function home(worktreeId: string): TerminalLeafHome {
  return { worktreeId, sessionTabId: 'tab-home', sessionLeafId: LEAF_FOREIGN }
}

function layout(homeByLeafId?: Record<string, TerminalLeafHome>): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: LEAF_NATIVE },
      second: { type: 'leaf', leafId: LEAF_FOREIGN }
    },
    activeLeafId: LEAF_NATIVE,
    expandedLeafId: null,
    ...(homeByLeafId ? { homeByLeafId } : {})
  }
}

const tabsByWorktree = { [HOST]: [{ id: 'host-tab' }], [HOME]: [{ id: 'home-tab' }] }

describe('buildTerminalPaneHomeIndex', () => {
  it('maps a foreign pane key to its home workspace', () => {
    const index = buildTerminalPaneHomeIndex(tabsByWorktree, {
      'host-tab': layout({ [LEAF_FOREIGN]: home(HOME) })
    })

    expect(index.homeWorktreeIdByPaneKey.get(`host-tab:${LEAF_FOREIGN}`)).toBe(HOME)
    expect(index.homeWorktreeIdByPaneKey.has(`host-tab:${LEAF_NATIVE}`)).toBe(false)
  })

  it('ignores entries naming the tab owner as native', () => {
    const index = buildTerminalPaneHomeIndex(tabsByWorktree, {
      'host-tab': layout({ [LEAF_FOREIGN]: home(HOST) })
    })

    expect(index.homeWorktreeIdByPaneKey.size).toBe(0)
  })

  it('ignores layouts of tabs that no workspace owns', () => {
    const index = buildTerminalPaneHomeIndex(tabsByWorktree, {
      'orphan-tab': layout({ [LEAF_FOREIGN]: home(HOME) })
    })

    expect(index.homeWorktreeIdByPaneKey.size).toBe(0)
  })

  it('ignores a stale home entry for a leaf no longer in the layout', () => {
    const staleLeaf = '33333333-3333-4333-8333-333333333333'
    const index = buildTerminalPaneHomeIndex(tabsByWorktree, {
      'host-tab': layout({ [staleLeaf]: home(HOME) })
    })

    expect(index.homeWorktreeIdByPaneKey.size).toBe(0)
    expect(index.foreignLeafIdsByTabId.size).toBe(0)
  })

  it('groups foreign leaf ids by their host tab', () => {
    const index = buildTerminalPaneHomeIndex(tabsByWorktree, {
      'host-tab': layout({ [LEAF_FOREIGN]: home(HOME) })
    })

    expect(index.foreignLeafIdsByTabId.get('host-tab')).toEqual(new Set([LEAF_FOREIGN]))
    expect(index.foreignLeafIdsByTabId.has('home-tab')).toBe(false)
  })

  it('returns the same index for the same inputs by reference', () => {
    const layouts = { 'host-tab': layout({ [LEAF_FOREIGN]: home(HOME) }) }

    expect(buildTerminalPaneHomeIndex(tabsByWorktree, layouts)).toBe(
      buildTerminalPaneHomeIndex(tabsByWorktree, layouts)
    )
  })

  it('rebuilds when the layouts reference changes', () => {
    const first = buildTerminalPaneHomeIndex(tabsByWorktree, {
      'host-tab': layout({ [LEAF_FOREIGN]: home(HOME) })
    })
    const second = buildTerminalPaneHomeIndex(tabsByWorktree, {
      'host-tab': layout({ [LEAF_FOREIGN]: home(HOME) })
    })

    expect(second).not.toBe(first)
  })

  it('treats missing inputs as empty', () => {
    const index = buildTerminalPaneHomeIndex(undefined, undefined)

    expect(index.homeWorktreeIdByPaneKey.size).toBe(0)
    expect(index.hostWorktreeIdByTabId.size).toBe(0)
  })
})

describe('resolvePaneNavigationWorktreeId', () => {
  const index = buildTerminalPaneHomeIndex(tabsByWorktree, {
    'host-tab': layout({ [LEAF_FOREIGN]: home(HOME) })
  })

  it('given a focus request naming the home of a foreign pane then it navigates to the host', () => {
    expect(resolvePaneNavigationWorktreeId(index, 'host-tab', LEAF_FOREIGN, HOME)).toBe(HOST)
  })

  it('given a native pane then it keeps the requested workspace', () => {
    expect(resolvePaneNavigationWorktreeId(index, 'host-tab', LEAF_NATIVE, HOST)).toBe(HOST)
  })

  it('given no leaf then it keeps the requested workspace', () => {
    expect(resolvePaneNavigationWorktreeId(index, 'host-tab', null, HOME)).toBe(HOME)
  })
})

describe('selectHomedTerminalLayouts', () => {
  it('keeps only layouts that carry home entries', () => {
    const homed = layout({ [LEAF_FOREIGN]: home(HOME) })
    const selected = selectHomedTerminalLayouts({ 'host-tab': homed, 'plain-tab': layout() })

    expect(selected).toEqual({ 'host-tab': homed })
  })

  it('returns one stable empty object while no layout carries a home entry', () => {
    expect(selectHomedTerminalLayouts({ a: layout() })).toBe(
      selectHomedTerminalLayouts({ b: layout(), c: layout() })
    )
  })

  it('keeps the previous reference when only native layouts change', () => {
    const homed = layout({ [LEAF_FOREIGN]: home(HOME) })
    const first = selectHomedTerminalLayouts({ 'host-tab': homed, 'plain-tab': layout() })
    const second = selectHomedTerminalLayouts({ 'host-tab': homed, 'plain-tab': layout() })

    expect(second).toBe(first)
  })

  it('returns a new object when a homed layout changes', () => {
    const first = selectHomedTerminalLayouts({ 'host-tab': layout({ [LEAF_FOREIGN]: home(HOME) }) })
    const second = selectHomedTerminalLayouts({
      'host-tab': layout({ [LEAF_FOREIGN]: home(HOME) })
    })

    expect(second).not.toBe(first)
  })

  it('shares the index between full and selected layouts', () => {
    const full = { 'host-tab': layout({ [LEAF_FOREIGN]: home(HOME) }), 'plain-tab': layout() }

    expect(buildTerminalPaneHomeIndex(tabsByWorktree, full)).toBe(
      buildTerminalPaneHomeIndex(tabsByWorktree, selectHomedTerminalLayouts(full))
    )
  })
})
