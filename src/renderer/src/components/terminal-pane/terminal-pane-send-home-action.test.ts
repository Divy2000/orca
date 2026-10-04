import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendTerminalPaneHome: vi.fn(),
  toastError: vi.fn(),
  getState: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
vi.mock('./terminal-pane-send-home', () => ({
  sendTerminalPaneHome: mocks.sendTerminalPaneHome
}))

import { requestTerminalPaneSendHome } from './terminal-pane-send-home-action'

const LEAF = '11111111-1111-4111-8111-111111111111'

describe('requestTerminalPaneSendHome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the pane addressed by tab and leaf home', () => {
    mocks.sendTerminalPaneHome.mockReturnValue({ ok: true, tabId: 'tab-home' })

    requestTerminalPaneSendHome('tab-host', LEAF)

    expect(mocks.sendTerminalPaneHome).toHaveBeenCalledWith(mocks.getState, `tab-host:${LEAF}`)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('tells the user when the terminal is not ready to move yet', () => {
    mocks.sendTerminalPaneHome.mockReturnValue({
      ok: false,
      reason: 'pane-not-ready'
    })

    requestTerminalPaneSendHome('tab-host', LEAF)

    expect(mocks.toastError).toHaveBeenCalledWith(
      'This terminal is still starting. Try again in a moment.'
    )
  })

  it('does nothing without a leaf', () => {
    requestTerminalPaneSendHome('tab-host', null)

    expect(mocks.sendTerminalPaneHome).not.toHaveBeenCalled()
  })
})
