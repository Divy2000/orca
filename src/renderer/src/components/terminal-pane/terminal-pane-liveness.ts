import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { collectLeafIdsInOrder } from './terminal-layout-leaf-ids'

/** Whether the pane still exists: its tab's layout holds the leaf. */
export function isLiveTerminalPaneKey(
  state: Pick<AppState, 'terminalLayoutsByTabId'>,
  paneKey: string
): boolean {
  const parsed = parsePaneKey(paneKey)
  const layout = parsed ? state.terminalLayoutsByTabId[parsed.tabId] : undefined
  return !!parsed && collectLeafIdsInOrder(layout?.root ?? null).includes(parsed.leafId)
}

/** Live-subscribed liveness of a row's pane; null (no pane) is never live. */
export function useIsLiveTerminalPaneKey(paneKey: string | null): boolean {
  return useAppStore((state) => paneKey !== null && isLiveTerminalPaneKey(state, paneKey))
}
