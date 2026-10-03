// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../../../../shared/update-status-types'
import { UpdateCardStateContent } from './UpdateCardStateContent'

afterEach(cleanup)

function renderContent(status: UpdateStatus): void {
  render(
    <UpdateCardStateContent
      status={status}
      changelog={null}
      errorCard={null}
      linuxPackageRecovery={null}
      isLocalBuild={false}
      hasStartedDownload={false}
      prefersReducedMotion={false}
      mediaFailed={false}
      mediaLoaded={false}
      onMediaError={vi.fn()}
      onMediaLoad={vi.fn()}
      onUpdate={vi.fn()}
      onInstallRetry={vi.fn()}
      onDismiss={vi.fn()}
      onCollapse={vi.fn()}
    />
  )
}

it('shows the main-process message for a not-available check', () => {
  renderContent({
    state: 'not-available',
    userInitiated: true,
    message: 'Updates are managed by the fork sync job; sync started.'
  })

  expect(screen.getByText('Updates are managed by the fork sync job; sync started.')).toBeTruthy()
  expect(screen.queryByText(/on the latest version/)).toBeNull()
})

it('keeps the latest-version copy when not-available carries no message', () => {
  renderContent({ state: 'not-available', userInitiated: true })

  expect(screen.getByText(/on the latest version/)).toBeTruthy()
})
