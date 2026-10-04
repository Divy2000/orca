import type { IDisposable } from '@xterm/xterm'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { resolveTerminalLeafHomeWorktreeId } from '../../../../shared/terminal-pane-home'

export type WakeHibernatedAgentsWorktreeEventDetail = {
  worktreeId: string
  wokenClaimKeys?: Set<string>
}

type WakeableBinding = IDisposable & {
  wakeHibernatedAgentIfArmed?: (claimedProviderSessions?: Set<string>) => string | null
}

/** Wakes this tab's armed panes that belong to `detail.worktreeId`, foreign panes by their home. */
export function wakeHibernatedPanesForWorktree(args: {
  detail: WakeHibernatedAgentsWorktreeEventDetail
  tabWorktreeId: string
  layout: TerminalLayoutSnapshot | undefined
  getLeafId: (paneId: number) => string | null
  bindings: ReadonlyMap<number, WakeableBinding>
}): void {
  const { detail } = args
  for (const [paneId, binding] of args.bindings) {
    const leafId = args.getLeafId(paneId)
    const paneWorktreeId = leafId
      ? resolveTerminalLeafHomeWorktreeId(args.layout, args.tabWorktreeId, leafId)
      : args.tabWorktreeId
    if (paneWorktreeId !== detail.worktreeId) {
      continue
    }
    const claimKey = binding.wakeHibernatedAgentIfArmed?.(detail.wokenClaimKeys)
    if (claimKey) {
      detail.wokenClaimKeys?.add(claimKey)
    }
  }
}
