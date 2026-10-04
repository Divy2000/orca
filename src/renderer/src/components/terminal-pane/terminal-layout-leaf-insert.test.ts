import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { insertTerminalLayoutLeaf } from './terminal-layout-leaf-insert'

const TARGET_A = '11111111-1111-4111-8111-111111111111'
const TARGET_B = '22222222-2222-4222-8222-222222222222'
const MOVED = '33333333-3333-4333-8333-333333333333'

const MOVED_HOME = {
  worktreeId: 'repo-1::/work/home',
  sessionTabId: 'tab-home',
  sessionLeafId: MOVED
}
const SIBLING_HOME = {
  worktreeId: 'repo-1::/work/other',
  sessionTabId: 'tab-other',
  sessionLeafId: TARGET_B
}

function targetLayout(): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      ratio: 0.4,
      first: { type: 'leaf', leafId: TARGET_A },
      second: { type: 'leaf', leafId: TARGET_B }
    },
    activeLeafId: TARGET_A,
    expandedLeafId: null,
    ptyIdsByLeafId: { [TARGET_A]: 'pty-a', [TARGET_B]: 'pty-b' },
    titlesByLeafId: { [TARGET_A]: 'a' },
    homeByLeafId: { [TARGET_B]: SIBLING_HOME }
  }
}

function movedLeafLayout(): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId: MOVED },
    activeLeafId: MOVED,
    expandedLeafId: null,
    ptyIdsByLeafId: { [MOVED]: 'pty-moved' },
    buffersByLeafId: { [MOVED]: 'buffer-moved' },
    scrollbackRefsByLeafId: { [MOVED]: 'scrollback-moved' },
    titlesByLeafId: { [MOVED]: 'moved title' },
    homeByLeafId: { [MOVED]: MOVED_HOME }
  }
}

describe('insertTerminalLayoutLeaf', () => {
  it('given an after placement then the moved leaf becomes the second child of a split around the target', () => {
    const inserted = insertTerminalLayoutLeaf({
      targetLayout: targetLayout(),
      targetLeafId: TARGET_B,
      insertedLayout: movedLeafLayout(),
      direction: 'horizontal',
      placement: 'after'
    })

    expect(inserted?.root).toEqual({
      type: 'split',
      direction: 'vertical',
      ratio: 0.4,
      first: { type: 'leaf', leafId: TARGET_A },
      second: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', leafId: TARGET_B },
        second: { type: 'leaf', leafId: MOVED }
      }
    })
  })

  it('given a before placement then the moved leaf becomes the first child', () => {
    const inserted = insertTerminalLayoutLeaf({
      targetLayout: targetLayout(),
      targetLeafId: TARGET_A,
      insertedLayout: movedLeafLayout(),
      direction: 'vertical',
      placement: 'before'
    })

    expect(inserted?.root).toEqual({
      type: 'split',
      direction: 'vertical',
      ratio: 0.4,
      first: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', leafId: MOVED },
        second: { type: 'leaf', leafId: TARGET_A }
      },
      second: { type: 'leaf', leafId: TARGET_B }
    })
  })

  it('given a single-leaf target then the split replaces the root', () => {
    const inserted = insertTerminalLayoutLeaf({
      targetLayout: {
        root: { type: 'leaf', leafId: TARGET_A },
        activeLeafId: TARGET_A,
        expandedLeafId: null
      },
      targetLeafId: TARGET_A,
      insertedLayout: movedLeafLayout(),
      direction: 'vertical',
      placement: 'after'
    })

    expect(inserted?.root).toEqual({
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: TARGET_A },
      second: { type: 'leaf', leafId: MOVED }
    })
  })

  it('carries the moved leaf pty, buffer, scrollback, title and home records next to the target records', () => {
    const inserted = insertTerminalLayoutLeaf({
      targetLayout: targetLayout(),
      targetLeafId: TARGET_A,
      insertedLayout: movedLeafLayout(),
      direction: 'vertical',
      placement: 'after'
    })

    expect(inserted?.ptyIdsByLeafId).toEqual({
      [TARGET_A]: 'pty-a',
      [TARGET_B]: 'pty-b',
      [MOVED]: 'pty-moved'
    })
    expect(inserted?.buffersByLeafId).toEqual({ [MOVED]: 'buffer-moved' })
    expect(inserted?.scrollbackRefsByLeafId).toEqual({
      [MOVED]: 'scrollback-moved'
    })
    expect(inserted?.titlesByLeafId).toEqual({
      [TARGET_A]: 'a',
      [MOVED]: 'moved title'
    })
    expect(inserted?.homeByLeafId).toEqual({
      [TARGET_B]: SIBLING_HOME,
      [MOVED]: MOVED_HOME
    })
  })

  it('focuses the moved leaf and clears an expanded pane that would hide it', () => {
    const inserted = insertTerminalLayoutLeaf({
      targetLayout: { ...targetLayout(), expandedLeafId: TARGET_A },
      targetLeafId: TARGET_A,
      insertedLayout: movedLeafLayout(),
      direction: 'vertical',
      placement: 'after'
    })

    expect(inserted?.activeLeafId).toBe(MOVED)
    expect(inserted?.expandedLeafId).toBeNull()
  })

  it('adds no home map when neither layout records a home', () => {
    const { homeByLeafId: _targetHomes, ...plainTarget } = targetLayout()
    const { homeByLeafId: _movedHomes, ...plainMoved } = movedLeafLayout()

    const inserted = insertTerminalLayoutLeaf({
      targetLayout: plainTarget,
      targetLeafId: TARGET_A,
      insertedLayout: plainMoved,
      direction: 'vertical',
      placement: 'after'
    })

    expect(Object.hasOwn(inserted ?? {}, 'homeByLeafId')).toBe(false)
  })

  it('returns null when the target leaf is not in the target layout', () => {
    expect(
      insertTerminalLayoutLeaf({
        targetLayout: targetLayout(),
        targetLeafId: '44444444-4444-4444-8444-444444444444',
        insertedLayout: movedLeafLayout(),
        direction: 'vertical',
        placement: 'after'
      })
    ).toBeNull()
  })

  it('returns null when the inserted layout holds more than one leaf', () => {
    expect(
      insertTerminalLayoutLeaf({
        targetLayout: {
          root: { type: 'leaf', leafId: MOVED },
          activeLeafId: MOVED,
          expandedLeafId: null
        },
        targetLeafId: MOVED,
        insertedLayout: targetLayout(),
        direction: 'vertical',
        placement: 'after'
      })
    ).toBeNull()
  })

  it('returns null when the target layout already holds the moved leaf', () => {
    const target = insertTerminalLayoutLeaf({
      targetLayout: targetLayout(),
      targetLeafId: TARGET_A,
      insertedLayout: movedLeafLayout(),
      direction: 'vertical',
      placement: 'after'
    })

    expect(
      insertTerminalLayoutLeaf({
        targetLayout: target,
        targetLeafId: TARGET_B,
        insertedLayout: movedLeafLayout(),
        direction: 'vertical',
        placement: 'after'
      })
    ).toBeNull()
  })
})
