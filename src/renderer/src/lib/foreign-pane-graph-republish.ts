import type { WorkspaceSessionPatch } from '../../../shared/workspace-session-state-types'

function carriesForeignPane(patch: WorkspaceSessionPatch): boolean {
  return Object.values(patch.terminalLayoutsByTabId ?? {}).some(
    (layout) => Object.keys(layout?.homeByLeafId ?? {}).length > 0
  )
}

/**
 * Main publishes a pane hosted from another workspace only once the host's persisted layout
 * attests its home, and the coalesced graph sync usually reaches main before the debounced session
 * write. Republish after a write carrying such a pane lands so main re-checks it.
 */
export function republishGraphAfterForeignPaneSessionWrite(
  patch: WorkspaceSessionPatch,
  write: Promise<void>,
  scheduleGraphSync: () => void
): void {
  if (!carriesForeignPane(patch)) {
    return
  }
  write.then(
    () => scheduleGraphSync(),
    // Why: the rejection stays on the caller's write promise; nothing new was attested.
    () => undefined
  )
}
