import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalPaneSplitDirection
} from '../../../../shared/terminal-tab-types'
import { collectLeafIdsInOrder } from './terminal-layout-leaf-ids'

/** Which side of the target the inserted leaf lands on: left/top drops are `before`. */
export type TerminalLayoutLeafPlacement = 'before' | 'after'

function wrapTargetLeaf(
  node: TerminalPaneLayoutNode,
  targetLeafId: string,
  inserted: TerminalPaneLayoutNode,
  direction: TerminalPaneSplitDirection,
  placement: TerminalLayoutLeafPlacement
): TerminalPaneLayoutNode {
  if (node.type === 'leaf') {
    if (node.leafId !== targetLeafId) {
      return node
    }
    const [first, second] = placement === 'before' ? [inserted, node] : [node, inserted]
    return { type: 'split', direction, first, second }
  }
  return {
    ...node,
    first: wrapTargetLeaf(node.first, targetLeafId, inserted, direction, placement),
    second: wrapTargetLeaf(node.second, targetLeafId, inserted, direction, placement)
  }
}

function withInsertedLeafRecord<T>(
  target: Record<string, T> | undefined,
  inserted: Record<string, T> | undefined,
  leafId: string
): Record<string, T> | undefined {
  const value = inserted?.[leafId]
  return value ? { ...target, [leafId]: value } : target
}

/**
 * Inserts a single-leaf layout (as `detachTerminalLayoutLeaf` produces) next to a target leaf,
 * carrying the leaf's PTY, scrollback, title and home records. Null when the shapes do not fit.
 */
export function insertTerminalLayoutLeaf(args: {
  targetLayout: TerminalLayoutSnapshot | null | undefined
  targetLeafId: string
  insertedLayout: TerminalLayoutSnapshot
  direction: TerminalPaneSplitDirection
  placement: TerminalLayoutLeafPlacement
}): TerminalLayoutSnapshot | null {
  const { targetLayout, insertedLayout } = args
  const insertedRoot = insertedLayout.root
  if (!targetLayout?.root || insertedRoot?.type !== 'leaf') {
    return null
  }
  const targetLeafIds = collectLeafIdsInOrder(targetLayout.root)
  const leafId = insertedRoot.leafId
  if (!targetLeafIds.includes(args.targetLeafId) || targetLeafIds.includes(leafId)) {
    return null
  }
  const ptyIdsByLeafId = withInsertedLeafRecord(
    targetLayout.ptyIdsByLeafId,
    insertedLayout.ptyIdsByLeafId,
    leafId
  )
  const buffersByLeafId = withInsertedLeafRecord(
    targetLayout.buffersByLeafId,
    insertedLayout.buffersByLeafId,
    leafId
  )
  const scrollbackRefsByLeafId = withInsertedLeafRecord(
    targetLayout.scrollbackRefsByLeafId,
    insertedLayout.scrollbackRefsByLeafId,
    leafId
  )
  const titlesByLeafId = withInsertedLeafRecord(
    targetLayout.titlesByLeafId,
    insertedLayout.titlesByLeafId,
    leafId
  )
  const homeByLeafId = withInsertedLeafRecord(
    targetLayout.homeByLeafId,
    insertedLayout.homeByLeafId,
    leafId
  )
  return {
    ...targetLayout,
    root: wrapTargetLeaf(
      targetLayout.root,
      args.targetLeafId,
      insertedRoot,
      args.direction,
      args.placement
    ),
    activeLeafId: leafId,
    // Why: an expanded sibling would hide the pane the user just placed.
    expandedLeafId: null,
    ...(ptyIdsByLeafId ? { ptyIdsByLeafId } : {}),
    ...(buffersByLeafId ? { buffersByLeafId } : {}),
    ...(scrollbackRefsByLeafId ? { scrollbackRefsByLeafId } : {}),
    ...(titlesByLeafId ? { titlesByLeafId } : {}),
    ...(homeByLeafId ? { homeByLeafId } : {})
  }
}
