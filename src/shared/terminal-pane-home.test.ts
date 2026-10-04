import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot, TerminalLeafHome } from './terminal-tab-types'
import {
  carryTerminalLeafHomes,
  normalizeTerminalLeafHomes,
  remapTerminalLeafHomeWorktreeId,
  repointSessionLeafHomes,
  resolveTerminalLeafHome,
  resolveTerminalLeafHomeWorktreeId
} from './terminal-pane-home'

const OWNER = 'repo-1::/work/owner'
const FOREIGN = 'repo-1::/work/foreign'
const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'

function home(worktreeId: string): TerminalLeafHome {
  return { worktreeId, sessionTabId: 'tab-home', sessionLeafId: LEAF_2 }
}

function splitLayout(homeByLeafId?: Record<string, TerminalLeafHome>): TerminalLayoutSnapshot {
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

describe('resolveTerminalLeafHome', () => {
  it('returns the entry for a leaf homed in another workspace', () => {
    const layout = splitLayout({ [LEAF_2]: home(FOREIGN) })

    expect(resolveTerminalLeafHome(layout, OWNER, LEAF_2)).toEqual(home(FOREIGN))
  })

  it('returns null when the layout has no home map', () => {
    expect(resolveTerminalLeafHome(splitLayout(), OWNER, LEAF_2)).toBeNull()
  })

  it('returns null for a missing layout', () => {
    expect(resolveTerminalLeafHome(undefined, OWNER, LEAF_2)).toBeNull()
  })

  it('returns null for a leaf without an entry', () => {
    const layout = splitLayout({ [LEAF_2]: home(FOREIGN) })

    expect(resolveTerminalLeafHome(layout, OWNER, LEAF_1)).toBeNull()
  })

  it('treats an entry naming the owner workspace as native', () => {
    const layout = splitLayout({ [LEAF_2]: home(OWNER) })

    expect(resolveTerminalLeafHome(layout, OWNER, LEAF_2)).toBeNull()
  })
})

describe('resolveTerminalLeafHomeWorktreeId', () => {
  it('returns the home workspace for a foreign leaf', () => {
    const layout = splitLayout({ [LEAF_2]: home(FOREIGN) })

    expect(resolveTerminalLeafHomeWorktreeId(layout, OWNER, LEAF_2)).toBe(FOREIGN)
  })

  it('falls back to the owner workspace for a native leaf', () => {
    expect(resolveTerminalLeafHomeWorktreeId(splitLayout(), OWNER, LEAF_1)).toBe(OWNER)
  })

  it('falls back to the owner workspace when the entry names the owner', () => {
    const layout = splitLayout({ [LEAF_2]: home(OWNER) })

    expect(resolveTerminalLeafHomeWorktreeId(layout, OWNER, LEAF_2)).toBe(OWNER)
  })
})

describe('normalizeTerminalLeafHomes', () => {
  it('returns the same layout reference when there is no home map', () => {
    const layout = splitLayout()

    expect(normalizeTerminalLeafHomes(layout, OWNER)).toBe(layout)
  })

  it('returns the same layout reference when every entry is valid', () => {
    const layout = splitLayout({ [LEAF_2]: home(FOREIGN) })

    expect(normalizeTerminalLeafHomes(layout, OWNER, new Set([OWNER, FOREIGN]))).toBe(layout)
  })

  it('keeps entries when no valid-workspace set is supplied', () => {
    const layout = splitLayout({ [LEAF_2]: home(FOREIGN) })

    expect(normalizeTerminalLeafHomes(layout, OWNER)).toBe(layout)
  })

  it('drops an entry whose leaf is not in the layout root', () => {
    const layout = splitLayout({ [LEAF_2]: home(FOREIGN), missing: home(FOREIGN) })

    const normalized = normalizeTerminalLeafHomes(layout, OWNER)

    expect(normalized.homeByLeafId).toEqual({ [LEAF_2]: home(FOREIGN) })
  })

  it('drops an entry whose home is the owner workspace', () => {
    const layout = splitLayout({ [LEAF_1]: home(OWNER), [LEAF_2]: home(FOREIGN) })

    const normalized = normalizeTerminalLeafHomes(layout, OWNER)

    expect(normalized.homeByLeafId).toEqual({ [LEAF_2]: home(FOREIGN) })
  })

  it('drops an entry whose home workspace no longer exists', () => {
    const layout = splitLayout({ [LEAF_2]: home(FOREIGN) })

    const normalized = normalizeTerminalLeafHomes(layout, OWNER, new Set([OWNER]))

    expect(normalized.homeByLeafId).toBeUndefined()
  })

  it('omits the home map entirely instead of emitting an empty object', () => {
    const layout = splitLayout({ [LEAF_2]: home(OWNER) })

    const normalized = normalizeTerminalLeafHomes(layout, OWNER)

    expect(Object.hasOwn(normalized, 'homeByLeafId')).toBe(false)
    expect(JSON.stringify(normalized)).toBe(JSON.stringify(splitLayout()))
  })

  it('does not mutate the input layout', () => {
    const layout = splitLayout({ [LEAF_2]: home(FOREIGN) })

    normalizeTerminalLeafHomes(layout, OWNER, new Set([OWNER]))

    expect(layout.homeByLeafId).toEqual({ [LEAF_2]: home(FOREIGN) })
  })

  it('drops every entry when the layout has no root', () => {
    const layout: TerminalLayoutSnapshot = {
      root: null,
      activeLeafId: null,
      expandedLeafId: null,
      homeByLeafId: { [LEAF_2]: home(FOREIGN) }
    }

    expect(normalizeTerminalLeafHomes(layout, OWNER).homeByLeafId).toBeUndefined()
  })
})

describe('carryTerminalLeafHomes', () => {
  it('keeps entries for leaves that are still mounted', () => {
    const prior = { [LEAF_1]: home(FOREIGN), [LEAF_2]: home(FOREIGN) }

    expect(carryTerminalLeafHomes(prior, new Set([LEAF_1, LEAF_2]))).toEqual(prior)
  })

  it('drops entries for leaves that are no longer mounted', () => {
    const prior = { [LEAF_1]: home(FOREIGN), [LEAF_2]: home(FOREIGN) }

    expect(carryTerminalLeafHomes(prior, new Set([LEAF_1]))).toEqual({ [LEAF_1]: home(FOREIGN) })
  })

  it('returns undefined when nothing survives', () => {
    expect(carryTerminalLeafHomes({ [LEAF_2]: home(FOREIGN) }, new Set([LEAF_1]))).toBeUndefined()
  })

  it('returns undefined when there is no prior map', () => {
    expect(carryTerminalLeafHomes(undefined, new Set([LEAF_1]))).toBeUndefined()
  })
})

describe('remapTerminalLeafHomeWorktreeId', () => {
  const RENAMED = 'repo-1::/work/renamed'

  it('repoints every pane home that names the renamed workspace', () => {
    const layouts = {
      'tab-a': splitLayout({ [LEAF_2]: home(FOREIGN) }),
      'tab-b': splitLayout({ [LEAF_2]: home(OWNER) })
    }

    const remapped = remapTerminalLeafHomeWorktreeId(layouts, FOREIGN, RENAMED)

    expect(remapped?.['tab-a']?.homeByLeafId?.[LEAF_2]).toEqual(home(RENAMED))
    expect(remapped?.['tab-b']).toBe(layouts['tab-b'])
  })

  it('returns null when no home names the renamed workspace', () => {
    expect(remapTerminalLeafHomeWorktreeId({ 'tab-a': splitLayout() }, FOREIGN, RENAMED)).toBeNull()
    expect(remapTerminalLeafHomeWorktreeId(undefined, FOREIGN, RENAMED)).toBeNull()
  })
})

describe('repointSessionLeafHomes', () => {
  it('rewrites the session layouts in place and reports whether anything changed', () => {
    const session = {
      terminalLayoutsByTabId: { 'tab-a': splitLayout({ [LEAF_2]: home(FOREIGN) }) }
    }

    expect(repointSessionLeafHomes(session, FOREIGN, OWNER)).toBe(true)
    expect(session.terminalLayoutsByTabId['tab-a']?.homeByLeafId?.[LEAF_2]?.worktreeId).toBe(OWNER)
    expect(repointSessionLeafHomes(session, FOREIGN, OWNER)).toBe(false)
  })
})
