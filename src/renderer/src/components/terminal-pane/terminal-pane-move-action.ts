import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  moveTerminalPaneIntoSplit,
  type TerminalPaneDropZone,
  type TerminalPaneMoveRejection
} from './terminal-pane-cross-workspace-move'

function rejectionMessage(reason: TerminalPaneMoveRejection): string {
  switch (reason) {
    case 'pane-missing':
      return translate(
        'auto.components.terminal.pane.terminalPaneMove.paneMissing',
        'This terminal is no longer open.'
      )
    case 'same-tab':
      return translate(
        'auto.components.terminal.pane.terminalPaneMove.sameTab',
        'This terminal is already in that tab.'
      )
    case 'different-host':
      return translate(
        'auto.components.terminal.pane.terminalPaneMove.differentHost',
        'Terminals can only join a split on the same host.'
      )
    case 'remote-host':
      return translate(
        'auto.components.terminal.pane.terminalPaneMove.remoteHost',
        "Terminals in remote workspaces can't move between tabs."
      )
    case 'remote-terminal':
      return translate(
        'auto.components.terminal.pane.terminalPaneMove.remoteTerminal',
        "Remote terminals can't move between tabs."
      )
    case 'native-chat':
      return translate(
        'auto.components.terminal.pane.terminalPaneMove.nativeChat',
        "Terminals shown as chat can't move between tabs."
      )
    case 'pane-not-ready':
      return translate(
        'auto.components.terminal.pane.terminalPaneHome.notReady',
        'This terminal is still starting. Try again in a moment.'
      )
  }
}

/** Drag-and-drop entry to join a pane into another tab's split; a refused move explains itself. */
export function requestTerminalPaneMoveIntoSplit(
  sourcePaneKey: string,
  targetPaneKey: string,
  zone: TerminalPaneDropZone
): boolean {
  const result = moveTerminalPaneIntoSplit(useAppStore.getState, sourcePaneKey, targetPaneKey, zone)
  if (!result.ok) {
    toast.error(rejectionMessage(result.reason))
  }
  return result.ok
}
