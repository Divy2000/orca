/**
 * @vitest-environment happy-dom
 */
import { act, createRef, type ReactNode, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import TerminalPaneHeaderOverlay from './TerminalPaneHeaderOverlay'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => children,
  TooltipContent: ({ children }: { children?: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replace(`{{${key}}}`, value),
      fallback
    )
}))
const mounted: { container: HTMLDivElement; root: Root }[] = []

function makePane(id: number): ManagedPane {
  const leafId = `leaf-${id}` as ManagedPane['leafId']
  return {
    id,
    leafId,
    stablePaneId: leafId,
    container: document.createElement('div'),
    linkTooltip: document.createElement('div'),
    terminal: {} as ManagedPane['terminal'],
    fitAddon: {} as ManagedPane['fitAddon'],
    searchAddon: {} as ManagedPane['searchAddon'],
    serializeAddon: {} as ManagedPane['serializeAddon']
  }
}

function renderOverlay({
  paneTitles,
  paneCount = 2,
  showAlwaysOnHeaders = true,
  showSplitButton = true,
  isTabPinned = false,
  onClosePane = vi.fn(),
  onRemoveTitle = vi.fn(),
  onRenameSubmit = vi.fn(),
  canContinueAgentSessionInNewSession = false,
  onContinueAgentSessionInNewSession = vi.fn(),
  renameValue = '',
  renamingPaneId = null,
  paneHomeLabels,
  onSendPaneHome = vi.fn<(pane: ManagedPane) => void>()
}: {
  paneTitles: Record<number, string>
  paneCount?: number
  showAlwaysOnHeaders?: boolean
  showSplitButton?: boolean
  isTabPinned?: boolean
  onClosePane?: ReturnType<typeof vi.fn>
  onRemoveTitle?: ReturnType<typeof vi.fn>
  onRenameSubmit?: ReturnType<typeof vi.fn>
  canContinueAgentSessionInNewSession?: boolean
  onContinueAgentSessionInNewSession?: ReturnType<typeof vi.fn>
  renameValue?: string
  renamingPaneId?: number | null
  paneHomeLabels?: Readonly<Record<string, string>>
  onSendPaneHome?: (pane: ManagedPane) => void
}): {
  container: HTMLDivElement
  onClosePane: ReturnType<typeof vi.fn>
  onRemoveTitle: ReturnType<typeof vi.fn>
  onRenameSubmit: ReturnType<typeof vi.fn>
} {
  const panes = [makePane(1), makePane(2)].slice(0, paneCount)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <TerminalPaneHeaderOverlay
        tabId="tab-1"
        worktreeId="wt-1"
        cwd={path.join(path.sep, 'tmp')}
        showAlwaysOnHeaders={showAlwaysOnHeaders}
        showSplitButton={showSplitButton}
        isTabPinned={isTabPinned}
        paneCount={paneCount}
        activePaneId={1}
        panes={panes}
        paneTitles={paneTitles}
        paneTitleOverlayRects={{
          1: { left: 0, top: 0, width: 200 },
          2: { left: 220, top: 0, width: 200 }
        }}
        renamingPaneId={renamingPaneId}
        renameValue={renameValue}
        renameInputRef={createRef<HTMLInputElement>()}
        titleUsesLightSurface={false}
        paneTitleBackground="transparent"
        terminalContentVisible
        hiddenStartupStyle={{}}
        managerRef={{ current: null } as RefObject<PaneManager | null>}
        paneTransportsRef={{ current: new Map() } as RefObject<Map<number, PtyTransport>>}
        canContinueAgentSessionInNewSession={canContinueAgentSessionInNewSession}
        onContinueAgentSessionInNewSession={
          onContinueAgentSessionInNewSession as (pane: ManagedPane) => void
        }
        onSplitPane={vi.fn()}
        onBeginPaneDrag={vi.fn()}
        onActivatePaneTitleInteraction={vi.fn()}
        onPaneTitleContextMenu={vi.fn()}
        onStartRename={vi.fn()}
        onRemoveTitle={onRemoveTitle as (paneId: number) => void}
        onClosePane={onClosePane as (paneId: number) => void}
        onRenameValueChange={vi.fn()}
        onRenameSubmit={onRenameSubmit as () => void}
        onRenameCancel={vi.fn()}
        onRenameBlur={vi.fn()}
        paneHomeLabels={paneHomeLabels}
        onSendPaneHome={onSendPaneHome}
      />
    )
  })
  mounted.push({ container, root })
  return { container, onClosePane, onRemoveTitle, onRenameSubmit }
}

function pressInputKey(
  input: HTMLInputElement,
  key: string,
  options?: { isComposing?: boolean; keyCode?: number }
): void {
  act(() => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true })
    if (options?.isComposing !== undefined) {
      Object.defineProperty(event, 'isComposing', { value: options.isComposing })
    }
    if (options?.keyCode !== undefined) {
      Object.defineProperty(event, 'keyCode', { value: options.keyCode })
    }
    input.dispatchEvent(event)
  })
}

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('TerminalPaneHeaderOverlay', () => {
  it('keeps the titled split-pane X as remove-title only', () => {
    const { container, onClosePane, onRemoveTitle } = renderOverlay({
      paneTitles: { 1: 'server', 2: '' }
    })

    const removeTitle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove pane title: server"]'
    )
    expect(removeTitle).not.toBeNull()
    expect(
      container.querySelector('.pane-title-bar[data-active-pane] button[aria-label="Close Pane"]')
    ).toBeNull()

    act(() => removeTitle?.click())

    expect(onRemoveTitle).toHaveBeenCalledWith(1)
    expect(onClosePane).not.toHaveBeenCalled()
  })

  it('offers close tab beside remove-title for a titled single pane', () => {
    const { container, onClosePane, onRemoveTitle } = renderOverlay({
      paneTitles: { 1: 'server' },
      paneCount: 1
    })

    expect(container.querySelector('button[aria-label="Remove pane title: server"]')).not.toBeNull()
    const closeTab = container.querySelector<HTMLButtonElement>('button[aria-label="Close tab"]')
    expect(closeTab).not.toBeNull()

    act(() => closeTab?.click())

    expect(onClosePane).toHaveBeenCalledWith(1)
    expect(onRemoveTitle).not.toHaveBeenCalled()
  })

  it('keeps split and close-pane controls available for untitled split pane headers', () => {
    const { container, onClosePane } = renderOverlay({
      paneTitles: { 1: '', 2: '' }
    })

    expect(container.querySelector('button[aria-label="Split Terminal Right"]')).not.toBeNull()
    expect(container.querySelector('.pane-title-drag-handle')).toBeNull()
    const closePane = container.querySelector<HTMLButtonElement>('button[aria-label="Close Pane"]')
    expect(closePane).not.toBeNull()

    act(() => closePane?.click())

    expect(onClosePane).toHaveBeenCalledWith(1)
  })

  it('offers close tab for an untitled single pane', () => {
    const { container, onClosePane } = renderOverlay({ paneTitles: { 1: '' }, paneCount: 1 })

    const closeTab = container.querySelector<HTMLButtonElement>('button[aria-label="Close tab"]')
    expect(closeTab).not.toBeNull()
    expect(container.querySelector('button[aria-label="Close Pane"]')).toBeNull()

    act(() => closeTab?.click())

    expect(onClosePane).toHaveBeenCalledWith(1)
  })

  it.each([
    { label: 'untitled', title: '' },
    { label: 'titled', title: 'server' }
  ])('keeps a pinned $label single-pane tab without a close button', ({ title }) => {
    const { container } = renderOverlay({
      paneTitles: { 1: title },
      paneCount: 1,
      isTabPinned: true
    })

    expect(container.querySelector('button[aria-label="Close tab"]')).toBeNull()
  })

  it('omits the split control when the header affordance is hidden', () => {
    const { container } = renderOverlay({
      paneTitles: { 1: '', 2: '' },
      paneCount: 1,
      showSplitButton: false
    })

    expect(container.querySelector('button[aria-label="Split Terminal Right"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Close tab"]')).toBeNull()
  })

  it('ignores IME composition Enter before submitting a pane title rename', () => {
    const { container, onRenameSubmit } = renderOverlay({
      paneTitles: { 1: 'server', 2: '' },
      renamingPaneId: 1,
      renameValue: '日本語 pane'
    })
    const input = container.querySelector<HTMLInputElement>('.pane-title-input')

    expect(input).not.toBeNull()

    pressInputKey(input as HTMLInputElement, 'Enter', { isComposing: true })

    expect(onRenameSubmit).not.toHaveBeenCalled()

    pressInputKey(input as HTMLInputElement, 'Enter')

    expect(onRenameSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows new-session continuation on the active agent pane header', () => {
    const onContinueAgentSessionInNewSession = vi.fn()
    const { container } = renderOverlay({
      paneTitles: { 1: '', 2: '' },
      canContinueAgentSessionInNewSession: true,
      onContinueAgentSessionInNewSession
    })
    const handoff = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Continue in New Session…"]'
    )

    expect(handoff).not.toBeNull()
    act(() => handoff?.click())

    expect(onContinueAgentSessionInNewSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 })
    )
  })

  it('offers Back to its workspace only on a pane hosted from another workspace', () => {
    const onSendPaneHome = vi.fn<(pane: ManagedPane) => void>()
    const { container } = renderOverlay({
      paneTitles: { 1: '', 2: '' },
      paneHomeLabels: { 'leaf-2': 'feature-login' },
      onSendPaneHome
    })

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Back to feature-login"]'
    )
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.closest('.pane-title-bar')?.hasAttribute('data-active-pane')).toBe(false)

    act(() => buttons[0]?.click())

    expect(onSendPaneHome).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it('shows no Back to button when every pane is native', () => {
    const { container } = renderOverlay({ paneTitles: { 1: '', 2: '' } })

    expect(container.querySelector('button[aria-label^="Back to"]')).toBeNull()
  })

  it('labels a pane hosted from another workspace with its home in a solid header', () => {
    const { container } = renderOverlay({
      paneTitles: { 1: '', 2: '' },
      paneHomeLabels: { 'leaf-2': 'feature-login' }
    })

    const [nativeHeader, foreignHeader] = container.querySelectorAll('.pane-title-bar')
    const label = foreignHeader?.querySelector('[data-pane-home-label]')
    expect(label?.textContent).toContain('feature-login')
    expect(foreignHeader?.textContent).toContain('From feature-login')
    expect(foreignHeader?.hasAttribute('data-chromeless')).toBe(false)
    expect(nativeHeader?.querySelector('[data-pane-home-label]')).toBeNull()
    expect(nativeHeader?.hasAttribute('data-chromeless')).toBe(true)
  })

  it('keeps the home label beside a pane title', () => {
    const { container } = renderOverlay({
      paneTitles: { 1: '', 2: 'build' },
      paneHomeLabels: { 'leaf-2': 'feature-login' }
    })

    const foreignHeader = container.querySelectorAll('.pane-title-bar')[1]
    expect(foreignHeader?.querySelector('[data-pane-home-label]')?.textContent).toContain(
      'feature-login'
    )
    expect(foreignHeader?.querySelector('.pane-title-text')?.textContent).toBe('build')
  })

  it('shows the home label in a background tab header too', () => {
    const { container } = renderOverlay({
      paneTitles: { 1: '', 2: '' },
      showAlwaysOnHeaders: false,
      paneHomeLabels: { 'leaf-2': 'feature-login' }
    })

    expect(container.querySelectorAll('.pane-title-bar')).toHaveLength(1)
    expect(container.querySelector('[data-pane-home-label]')?.textContent).toContain(
      'feature-login'
    )
  })

  it('shows no home label when every pane is native', () => {
    const { container } = renderOverlay({ paneTitles: { 1: '', 2: '' } })

    expect(container.querySelector('[data-pane-home-label]')).toBeNull()
  })
})
