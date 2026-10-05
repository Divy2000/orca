import { House } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useAppStore } from '../../store'
import { resolveTerminalLeafHome } from '../../../../shared/terminal-pane-home'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { collectLeafIdsInOrder } from '../terminal-pane/terminal-layout-leaf-ids'
import { terminalPaneBackHomeLabel } from '../terminal-pane/TerminalPaneBackHomeButton'
import {
  parseTerminalPaneHomeLabelsKey,
  selectTerminalPaneHomeLabelsKey
} from '../terminal-pane/use-terminal-pane-home-labels'
import { requestTerminalPaneSendHome } from '../terminal-pane/terminal-pane-send-home-action'

/** The tab's only pane, or its active one, when that pane is hosted from another workspace. */
export function resolveTerminalTabForeignPaneLeafId(
  layout: TerminalLayoutSnapshot | undefined,
  hostWorktreeId: string
): string | null {
  const leafIds = collectLeafIdsInOrder(layout?.root)
  const leafId = leafIds.length === 1 ? leafIds[0] : layout?.activeLeafId
  return leafId &&
    leafIds.includes(leafId) &&
    resolveTerminalLeafHome(layout, hostWorktreeId, leafId)
    ? leafId
    : null
}

export function TerminalTabBackHomeMenuItem({
  tabId,
  worktreeId
}: {
  tabId: string
  worktreeId: string
}): React.JSX.Element | null {
  const layout = useAppStore((state) => state.terminalLayoutsByTabId[tabId])
  const leafId = resolveTerminalTabForeignPaneLeafId(layout, worktreeId)
  // Why: labels exist only for reachable homes, so a stale home hides the item.
  const labelsKey = useAppStore((state) =>
    selectTerminalPaneHomeLabelsKey(state, tabId, worktreeId)
  )
  const workspaceName = leafId ? parseTerminalPaneHomeLabelsKey(labelsKey)[leafId] : undefined
  if (!leafId || !workspaceName) {
    return null
  }
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => requestTerminalPaneSendHome(tabId, leafId)}>
        <House className="size-3.5 shrink-0" />
        {terminalPaneBackHomeLabel(workspaceName)}
      </DropdownMenuItem>
    </>
  )
}
