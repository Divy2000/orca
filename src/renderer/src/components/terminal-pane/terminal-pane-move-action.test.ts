import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  moveTerminalPaneIntoSplit: vi.fn(),
  toastError: vi.fn(),
  getState: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
vi.mock('./terminal-pane-cross-workspace-move', () => ({
  moveTerminalPaneIntoSplit: mocks.moveTerminalPaneIntoSplit
}))

import { requestTerminalPaneMoveIntoSplit } from './terminal-pane-move-action'

const SOURCE = 'tab-source:11111111-1111-4111-8111-111111111111'
const TARGET = 'tab-target:22222222-2222-4222-8222-222222222222'

describe('requestTerminalPaneMoveIntoSplit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('given a movable pane, it joins the target split without a toast', () => {
    mocks.moveTerminalPaneIntoSplit.mockReturnValue({ ok: true })

    expect(requestTerminalPaneMoveIntoSplit(SOURCE, TARGET, 'bottom')).toBe(true)

    expect(mocks.moveTerminalPaneIntoSplit).toHaveBeenCalledWith(
      mocks.getState,
      SOURCE,
      TARGET,
      'bottom'
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it.each([
    ['pane-missing', 'This terminal is no longer open.'],
    ['same-tab', 'This terminal is already in that tab.'],
    ['different-host', 'Terminals can only join a split on the same host.'],
    ['remote-host', "Terminals in remote workspaces can't move between tabs."],
    ['remote-terminal', "Remote terminals can't move between tabs."],
    ['native-chat', "Terminals shown as chat can't move between tabs."],
    ['pane-not-ready', 'This terminal is still starting. Try again in a moment.']
  ])('given a %s rejection, it explains why in a toast', (reason, message) => {
    mocks.moveTerminalPaneIntoSplit.mockReturnValue({ ok: false, reason })

    expect(requestTerminalPaneMoveIntoSplit(SOURCE, TARGET, 'left')).toBe(false)

    expect(mocks.toastError).toHaveBeenCalledWith(message)
  })
})
