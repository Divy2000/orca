import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

/** Always-visible label naming the workspace a hosted pane belongs to; nothing for native panes. */
function TerminalPaneHomeLabel({
  workspaceName
}: {
  workspaceName: string | undefined
}): React.JSX.Element | null {
  if (!workspaceName) {
    return null
  }
  const label = translate(
    'auto.components.terminal.pane.terminalPaneHome.from',
    'From {{value0}}',
    {
      value0: workspaceName
    }
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="pane-title-home-label" data-pane-home-label="" aria-label={label}>
          {workspaceName}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** The leading text of a pane header: its home workspace when hosted, then its rename-able title. */
export function TerminalPaneHeaderTitle({
  homeWorkspaceName,
  title,
  onStartRename
}: {
  homeWorkspaceName: string | undefined
  title: string | undefined
  onStartRename: () => void
}): React.JSX.Element {
  return (
    <>
      <TerminalPaneHomeLabel workspaceName={homeWorkspaceName} />
      {title ? (
        <button
          type="button"
          className="pane-title-text"
          onClick={onStartRename}
          aria-label={translate(
            'auto.components.terminal.pane.TerminalPane.cc5a2dc706',
            'Edit pane title: {{value0}}',
            { value0: title }
          )}
        >
          {title}
        </button>
      ) : null}
    </>
  )
}
