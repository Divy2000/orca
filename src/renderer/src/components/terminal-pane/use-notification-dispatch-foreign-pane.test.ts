import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchTerminalNotification } from './use-notification-dispatch'
import {
  LIVE_LEAF_ID,
  PANE_KEY,
  resetNotificationDispatchMockState,
  type NotificationDispatchMockState
} from './notification-dispatch-test-harness'

vi.mock('@/store', async () => {
  const harness = await import('./notification-dispatch-test-harness')
  return harness.createNotificationDispatchStoreModuleMock()
})

vi.mock('@/lib/desktop-notification-sound', async () => {
  const harness = await import('./notification-dispatch-test-harness')
  return harness.createDesktopNotificationSoundModuleMock()
})

let mockState: NotificationDispatchMockState

describe('dispatchTerminalNotification for a pane hosted in another workspace', () => {
  beforeEach(() => {
    mockState = resetNotificationDispatchMockState()
    // The pane lives in a tab of wt-primary but belongs to wt-secondary.
    mockState.terminalLayoutsByTabId['tab-1'] = {
      ...mockState.terminalLayoutsByTabId['tab-1'],
      homeByLeafId: {
        [LIVE_LEAF_ID]: {
          worktreeId: 'wt-secondary',
          sessionTabId: 'tab-home',
          sessionLeafId: LIVE_LEAF_ID
        }
      }
    }
    mockState.activeWorktreeId = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('given a completion on a foreign pane then the home is marked unread and notified', () => {
    dispatchTerminalNotification('wt-primary', {
      source: 'agent-task-complete',
      terminalTitle: 'codex',
      paneKey: PANE_KEY
    })

    expect(mockState.markWorktreeUnread).toHaveBeenCalledWith('wt-secondary')
    expect(mockState.markWorktreeUnread).not.toHaveBeenCalledWith('wt-primary')
    expect(window.api.notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt-secondary', paneKey: PANE_KEY })
    )
  })

  it('given a bell on a foreign pane then the notification names the home', () => {
    dispatchTerminalNotification('wt-primary', { source: 'terminal-bell', paneKey: PANE_KEY })

    expect(window.api.notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'terminal-bell', worktreeId: 'wt-secondary' })
    )
  })

  it('given no home entry then the tab owner is marked unread as before', () => {
    delete mockState.terminalLayoutsByTabId['tab-1'].homeByLeafId

    dispatchTerminalNotification('wt-primary', {
      source: 'agent-task-complete',
      terminalTitle: 'codex',
      paneKey: PANE_KEY
    })

    expect(mockState.markWorktreeUnread).toHaveBeenCalledWith('wt-primary')
  })
})
