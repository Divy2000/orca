export type RuntimePaneTitleLeafIdsByTabId = Record<string, Record<number, string>>

/**
 * Sets or (with no `leafId`) removes one pane title's leaf binding, returning `bindings` itself
 * when nothing changes so subscribers keep their identity.
 */
export function withRuntimePaneTitleLeafBinding(
  bindings: RuntimePaneTitleLeafIdsByTabId,
  tabId: string,
  paneId: number,
  leafId: string | undefined
): RuntimePaneTitleLeafIdsByTabId {
  const byPane = bindings[tabId]
  if (byPane?.[paneId] === leafId) {
    return bindings
  }
  const nextByPane = { ...byPane }
  if (leafId === undefined) {
    delete nextByPane[paneId]
  } else {
    nextByPane[paneId] = leafId
  }
  const next = { ...bindings }
  if (Object.keys(nextByPane).length > 0) {
    next[tabId] = nextByPane
  } else {
    delete next[tabId]
  }
  return next
}
