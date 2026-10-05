import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { sendTerminalPaneHome } from './terminal-pane-send-home'

/** The "Back to {workspace}" action shared by the pane header, pane menu and tab menu. */
export function requestTerminalPaneSendHome(
  tabId: string,
  leafId: string | null | undefined
): void {
  if (!leafId) {
    return
  }
  const result = sendTerminalPaneHome(useAppStore.getState, makePaneKey(tabId, leafId))
  if (!result.ok && result.reason === 'pane-not-ready') {
    toast.error(
      translate(
        'auto.components.terminal.pane.terminalPaneHome.notReady',
        'This terminal is still starting. Try again in a moment.'
      )
    )
  }
}
