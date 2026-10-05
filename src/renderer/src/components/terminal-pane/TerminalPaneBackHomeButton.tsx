import { House } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export function terminalPaneBackHomeLabel(workspaceName: string): string {
  return translate('auto.components.terminal.pane.terminalPaneHome.backTo', 'Back to {{value0}}', {
    value0: workspaceName
  })
}

/** Header action for a pane hosted in another workspace's tab; renders nothing for native panes. */
export function TerminalPaneBackHomeButton({
  workspaceName,
  onSendHome
}: {
  workspaceName: string | undefined
  onSendHome: () => void
}): React.JSX.Element | null {
  if (!workspaceName) {
    return null
  }
  const label = terminalPaneBackHomeLabel(workspaceName)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="pane-title-split-trigger"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation()
            onSendHome()
          }}
        >
          <House className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
