import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import { buildTerminalPaneHomeIndex } from './terminal-pane-home-index'
import {
  collectForeignLeafIdsByTabId,
  collectHomedPaneStatusInputs,
  omitForeignPanePtyIds,
  omitForeignPaneTitles
} from './terminal-host-native-pane-inputs'
import { getWorktreeStatus } from './worktree-status'

const W1 = 'repo-1::/work/w1'
const W2 = 'repo-1::/work/w2'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'

function hostLayout(withHome: boolean): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: NATIVE_LEAF },
      second: { type: 'leaf', leafId: FOREIGN_LEAF }
    },
    activeLeafId: NATIVE_LEAF,
    expandedLeafId: null,
    ptyIdsByLeafId: { [NATIVE_LEAF]: 'pty-native', [FOREIGN_LEAF]: 'pty-foreign' },
    ...(withHome
      ? {
          homeByLeafId: {
            [FOREIGN_LEAF]: { worktreeId: W1, sessionTabId: 'tab-w1', sessionLeafId: FOREIGN_LEAF }
          }
        }
      : {})
  }
}

const tabsByWorktree = { [W1]: [{ id: 'tab-w1' }], [W2]: [{ id: 'tab-w2' }] }
// Runtime pane 2 is the second leaf in replay order: the foreign one.
const titles = { 'tab-w2': { 1: 'zsh', 2: '⠋ Claude Code' } }
const LIVE_PTY_IDS = { 'tab-w2': ['pty-native', 'pty-foreign'] }

function inputs(withHome: boolean) {
  const layouts = { 'tab-w2': hostLayout(withHome) }
  const index = buildTerminalPaneHomeIndex(tabsByWorktree, layouts).foreignLeafIdsByTabId
  return { layouts, index }
}

describe('omitForeignPaneTitles', () => {
  it('given a working title on a foreign pane then the host status ignores it', () => {
    const { layouts, index } = inputs(true)

    const status = getWorktreeStatus(
      [{ id: 'tab-w2', title: 'zsh' }],
      [],
      omitForeignPanePtyIds({ 'tab-w2': ['pty-native', 'pty-foreign'] }, layouts, index),
      omitForeignPaneTitles(titles, layouts, index, LIVE_PTY_IDS, {})
    )

    expect(status).toBe('active')
  })

  it('given the same title on a native pane then the host status is working', () => {
    const { layouts, index } = inputs(false)

    const status = getWorktreeStatus(
      [{ id: 'tab-w2', title: 'zsh' }],
      [],
      omitForeignPanePtyIds({ 'tab-w2': ['pty-native', 'pty-foreign'] }, layouts, index),
      omitForeignPaneTitles(titles, layouts, index, LIVE_PTY_IDS, {})
    )

    expect(status).toBe('working')
  })

  it('returns the input record when no tab hosts a foreign pane', () => {
    const { layouts, index } = inputs(false)

    expect(omitForeignPaneTitles(titles, layouts, index, LIVE_PTY_IDS, {})).toBe(titles)
  })
})

describe('collectForeignLeafIdsByTabId', () => {
  it('lists the foreign leaves of the owner tabs and matches the shared index', () => {
    const { layouts, index } = inputs(true)

    expect(collectForeignLeafIdsByTabId(tabsByWorktree[W2], layouts, W2)).toEqual(index)
  })

  it('ignores a stale home entry for a leaf no longer in the layout', () => {
    const staleLeaf = '33333333-3333-4333-8333-333333333333'
    const stale = {
      'tab-w2': {
        ...hostLayout(false),
        homeByLeafId: {
          [staleLeaf]: { worktreeId: W1, sessionTabId: 'tab-w1', sessionLeafId: staleLeaf }
        }
      }
    }

    expect(collectForeignLeafIdsByTabId([{ id: 'tab-w2' }], stale, W2).size).toBe(0)
  })

  it('treats an entry naming the owner as native', () => {
    const { layouts } = inputs(true)

    expect(collectForeignLeafIdsByTabId([{ id: 'tab-w2' }], layouts, W1).size).toBe(0)
  })
})

describe('omitForeignPanePtyIds', () => {
  it('given a foreign leaf whose pty binding has not hydrated then the unmapped pty is not credited to the host', () => {
    const { layouts, index } = inputs(true)
    const hydrating = {
      'tab-w2': { ...layouts['tab-w2'], ptyIdsByLeafId: { [NATIVE_LEAF]: 'pty-native' } }
    }

    expect(
      omitForeignPanePtyIds({ 'tab-w2': ['pty-native', 'pty-foreign'] }, hydrating, index)
    ).toEqual({ 'tab-w2': ['pty-native'] })
  })

  it('drops the foreign pane pty and keeps native ones', () => {
    const { layouts, index } = inputs(true)

    expect(
      omitForeignPanePtyIds({ 'tab-w2': ['pty-native', 'pty-foreign'] }, layouts, index)
    ).toEqual({ 'tab-w2': ['pty-native'] })
  })

  it('drops a tab whose only live pty is foreign', () => {
    const { layouts, index } = inputs(true)

    expect(omitForeignPanePtyIds({ 'tab-w2': ['pty-foreign'] }, layouts, index)).toEqual({})
  })

  it('returns the input record when no tab hosts a foreign pane', () => {
    const { layouts, index } = inputs(false)
    const ptyIds = { 'tab-w2': ['pty-native', 'pty-foreign'] }

    expect(omitForeignPanePtyIds(ptyIds, layouts, index)).toBe(ptyIds)
  })
})

describe('collectHomedPaneStatusInputs', () => {
  it('given a working title on a foreign pane then its home reads working', () => {
    const { layouts } = inputs(true)
    const homeIndex = buildTerminalPaneHomeIndex(tabsByWorktree, layouts)
    const homed = collectHomedPaneStatusInputs(
      homeIndex,
      W1,
      layouts,
      { 'tab-w2': ['pty-native', 'pty-foreign'] },
      titles,
      {}
    )

    expect(homed?.ptyIdsByTabId).toEqual({ 'tab-w2': ['pty-foreign'] })
    expect(
      getWorktreeStatus(
        homed?.tabs ?? [],
        [],
        homed?.ptyIdsByTabId ?? {},
        homed?.runtimePaneTitlesByTabId
      )
    ).toBe('working')
  })

  it('returns null for a workspace that owns no panes in other tabs', () => {
    const { layouts } = inputs(true)

    expect(
      collectHomedPaneStatusInputs(
        buildTerminalPaneHomeIndex(tabsByWorktree, layouts),
        W2,
        layouts,
        {},
        titles,
        {}
      )
    ).toBeNull()
  })
})

describe('omitForeignPaneTitles with parked or sparse runtime pane ids', () => {
  const livePtyIds = { 'tab-w2': ['pty-native', 'pty-foreign'] }

  it('given a parked slot title on the foreign leaf then the host is not credited and the home is', () => {
    const { layouts, index } = inputs(true)
    const parked = { 'tab-w2': { [-2]: 'Codex - action required' } }

    expect(omitForeignPaneTitles(parked, layouts, index, livePtyIds, {})).toEqual({})
    expect(
      collectHomedPaneStatusInputs(
        buildTerminalPaneHomeIndex(tabsByWorktree, layouts),
        W1,
        layouts,
        livePtyIds,
        parked,
        {}
      )?.runtimePaneTitlesByTabId
    ).toEqual(parked)
  })

  it('given a sparse pane id bound through its pty to the foreign leaf then the host is not credited', () => {
    const { layouts, index } = inputs(true)
    const sparse = { 'tab-w2': { 1: 'zsh', 3: '⠋ Claude Code' } }

    expect(omitForeignPaneTitles(sparse, layouts, index, livePtyIds, {})).toEqual({
      'tab-w2': { 1: 'zsh' }
    })
  })

  it('given a title no slot or pty binding can place then the host is not credited', () => {
    const { layouts, index } = inputs(true)
    const unplaceable = { 'tab-w2': { 1: 'zsh', 3: '⠋ Claude Code' } }

    expect(
      omitForeignPaneTitles(unplaceable, layouts, index, { 'tab-w2': ['pty-native'] }, {})
    ).toEqual({})
  })
})

describe('pane title placement through explicit leaf bindings', () => {
  const livePtyIds = { 'tab-w2': ['pty-native', 'pty-foreign'] }

  it('given only the foreign title with a leaf binding then the home reads working and the host drops it', () => {
    const { layouts, index } = inputs(true)
    const foreignOnly = { 'tab-w2': { 2: '⠋ Claude Code' } }
    const bindings = { 'tab-w2': { 2: FOREIGN_LEAF } }

    expect(omitForeignPaneTitles(foreignOnly, layouts, index, livePtyIds, bindings)).toEqual({})
    const homed = collectHomedPaneStatusInputs(
      buildTerminalPaneHomeIndex(tabsByWorktree, layouts),
      W1,
      layouts,
      livePtyIds,
      foreignOnly,
      bindings
    )
    expect(
      getWorktreeStatus(
        homed?.tabs ?? [],
        [],
        homed?.ptyIdsByTabId ?? {},
        homed?.runtimePaneTitlesByTabId
      )
    ).toBe('working')
  })

  it('given bindings that contradict live PTY order then the bindings decide', () => {
    const { layouts, index } = inputs(true)
    const sparse = { 'tab-w2': { 2: '⠋ Claude Code', 4: 'zsh' } }
    const bindings = { 'tab-w2': { 2: FOREIGN_LEAF, 4: NATIVE_LEAF } }

    expect(omitForeignPaneTitles(sparse, layouts, index, livePtyIds, bindings)).toEqual({
      'tab-w2': { 4: 'zsh' }
    })
  })
})
