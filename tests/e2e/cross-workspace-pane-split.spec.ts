import { existsSync, readFileSync } from 'node:fs'
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  dragWorkspaceCardTo,
  listTerminalsWithCli,
  openWorkspaceTerminal,
  paneEdgePoint,
  paneHeaders,
  readPaneBuffer,
  readTabPanes,
  resolveSeededWorkspaces,
  typeIntoPane,
  waitForPaneBuffer,
  workspaceCard,
  type SeededWorkspace
} from './helpers/cross-workspace-pane-fixture'
import { SORTABLE_TAB } from './helpers/terminal-tab-menu'
import { splitMarkerEchoCommand } from './terminal-marker-echo-command'
import { TEST_REPO_PATH_FILE } from './global-setup'

const BOARD_SHEET = '[data-workspace-board-sheet]'
const DROP_OVERLAY = '.pane-drop-overlay'

type PreparedMove = {
  w1: SeededWorkspace
  w2: SeededWorkspace
  source: { tabId: string; ptyId: string }
  host: { tabId: string; ptyId: string; leafId: string }
  preMoveMarker: string
}

type MovedPane = PreparedMove & { movedLeafId: string }

async function saveScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: file, animations: 'disabled' })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}

async function readLeafHome(page: Page, tabId: string, leafId: string): Promise<string | null> {
  return page.evaluate(
    ({ tabId, leafId }) =>
      window.__store?.getState().terminalLayoutsByTabId[tabId]?.homeByLeafId?.[leafId]
        ?.worktreeId ?? null,
    { tabId, leafId }
  )
}

async function readTabPtyIds(page: Page, tabId: string): Promise<(string | null)[]> {
  return (await readTabPanes(page, tabId)).map((pane) => pane.ptyId)
}

/** Opens a terminal in W1 that has printed a marker, then a terminal in W2 to host it. */
async function prepareSourceAndHost(page: Page): Promise<PreparedMove> {
  const { w1, w2 } = await resolveSeededWorkspaces(page)
  const source = await openWorkspaceTerminal(page, w1.id)
  const sourceLeafId = (await readTabPanes(page, source.tabId))[0]?.leafId
  if (!sourceLeafId) {
    throw new Error('W1 terminal tab rendered no pane')
  }
  const marker = ['PRE_MOVE_', String(Date.now())] as const
  await typeIntoPane(page, source.tabId, sourceLeafId, splitMarkerEchoCommand(...marker))
  await waitForPaneBuffer(page, source.tabId, sourceLeafId, marker.join(''))

  const host = await openWorkspaceTerminal(page, w2.id)
  const hostPanes = await readTabPanes(page, host.tabId)
  expect(hostPanes).toHaveLength(1)
  return {
    w1,
    w2,
    source,
    host: { ...host, leafId: hostPanes[0]!.leafId },
    preMoveMarker: marker.join('')
  }
}

/** The drop landed: W2's tab shows its own pane plus W1's PTY, and W1's emptied tab closed. */
async function expectPaneJoinedHost(page: Page, prepared: PreparedMove): Promise<MovedPane> {
  const { w1, source, host } = prepared
  await expect
    .poll(() => readTabPtyIds(page, host.tabId), { timeout: 15_000 })
    .toEqual([host.ptyId, source.ptyId])
  const movedLeafId = (await readTabPanes(page, host.tabId))[1]!.leafId
  await expect
    .poll(() =>
      page.evaluate(
        (id) => (window.__store?.getState().tabsByWorktree[id] ?? []).map((tab) => tab.id),
        w1.id
      )
    )
    .not.toContain(source.tabId)
  expect(await readLeafHome(page, host.tabId, movedLeafId)).toBe(w1.id)
  await expect(
    paneHeaders(page, host.tabId).getByRole('button', { name: `Back to ${w1.name}` })
  ).toHaveCount(1)
  await expectHomeLabel(page, host.tabId, w1.name)
  await waitForPaneBuffer(page, host.tabId, movedLeafId, prepared.preMoveMarker)
  return { ...prepared, movedLeafId }
}

/** The always-visible header label naming the moved pane's home, alone among the tab's panes. */
async function expectHomeLabel(page: Page, tabId: string, homeName: string): Promise<void> {
  const label = paneHeaders(page, tabId).locator('[data-pane-home-label]')
  await expect(label).toHaveCount(1)
  await expect(label).toBeVisible()
  await expect(label).toHaveText(homeName)
  await expect(label).toHaveAttribute('aria-label', `From ${homeName}`)
}

async function expectMovedPaneIsLive(page: Page, moved: MovedPane, label: string): Promise<void> {
  const marker = [`${label}_`, String(Date.now())] as const
  await typeIntoPane(page, moved.host.tabId, moved.movedLeafId, splitMarkerEchoCommand(...marker))
  await waitForPaneBuffer(page, moved.host.tabId, moved.movedLeafId, marker.join(''))
  expect(await readPaneBuffer(page, moved.host.tabId, moved.host.leafId)).not.toContain(
    marker.join('')
  )
}

/** A real pointer drag of W1's sidebar card onto the right edge of W2's pane. */
async function dragW1CardIntoHost(
  page: Page,
  prepared: PreparedMove,
  whileOver?: () => Promise<void>
): Promise<MovedPane> {
  const dropPoint = await paneEdgePoint(page, prepared.host.tabId, prepared.host.leafId, 'right')
  await dragWorkspaceCardTo(page, prepared.w1.id, dropPoint, whileOver)
  await expect(page.locator(BOARD_SHEET)).toHaveCount(0)
  await expect(page.locator(DROP_OVERLAY)).toHaveCount(0)
  return expectPaneJoinedHost(page, prepared)
}

function seededRepoPath(): string {
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  if (!repoPath || !existsSync(repoPath)) {
    throw new Error('Cross-workspace restart E2E requires the seeded test repo from global setup')
  }
  return repoPath
}

test.describe('cross-workspace pane splits', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await orcaPage.setViewportSize({ width: 1400, height: 900 })
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('a workspace card dropped on a pane moves its live terminal into the split, attributed to its home', async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    test.setTimeout(240_000)
    const prepared = await prepareSourceAndHost(orcaPage)
    const { w1, w2, source, host } = prepared

    const moved = await dragW1CardIntoHost(orcaPage, prepared, async () => {
      await expect(orcaPage.locator(DROP_OVERLAY)).toBeVisible()
      // Dragging a sidebar card over a pane must not open the Kanban board.
      await expect(orcaPage.locator(BOARD_SHEET)).toHaveCount(0)
      // Header controls must not show through the translucent drop overlay.
      await expect(paneHeaders(orcaPage, host.tabId).locator('.pane-title-actions')).toBeHidden()
      await saveScreenshot(orcaPage, testInfo, 'drop-overlay-mid-drag')
    })
    await expectMovedPaneIsLive(orcaPage, moved, 'MOVED_LIVE')

    // A bell in the moved pane marks W1 unread, not the W2 host it sits in.
    await orcaPage.evaluate(
      (ids) => ids.forEach((id) => window.__store?.getState().clearWorktreeUnread(id)),
      [w1.id, w2.id]
    )
    await expect(
      workspaceCard(orcaPage, w1.id).getByRole('button', { name: 'Mark as unread' })
    ).toBeVisible()
    await typeIntoPane(orcaPage, host.tabId, moved.movedLeafId, "printf '\\a'")
    await expect(
      workspaceCard(orcaPage, w1.id).getByRole('button', { name: 'Mark as read' })
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      workspaceCard(orcaPage, w2.id).getByRole('button', { name: 'Mark as read' })
    ).toHaveCount(0)

    // `orca terminal list --json` lists the moved terminal under W1, hosted in W2's tab.
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    await expect
      .poll(
        async () =>
          (await listTerminalsWithCli(userDataDir))
            .filter((terminal) => terminal.ptyId === source.ptyId)
            .map((terminal) => ({ worktreeId: terminal.worktreeId, tabId: terminal.tabId })),
        { timeout: 30_000 }
      )
      .toEqual([{ worktreeId: w1.id, tabId: host.tabId }])
    expect(
      (await listTerminalsWithCli(userDataDir, w2.id)).map((terminal) => terminal.ptyId)
    ).not.toContain(source.ptyId)

    const backButton = paneHeaders(orcaPage, host.tabId).getByRole('button', {
      name: `Back to ${w1.name}`
    })
    await expect(backButton).toBeVisible()
    // Why: the host shell's first prompt can lag; capture the split once both panes have painted.
    await expect
      .poll(() => readPaneBuffer(orcaPage, host.tabId, host.leafId), { timeout: 20_000 })
      .not.toBe('')
    for (const theme of ['light', 'dark'] as const) {
      await orcaPage.evaluate(async (theme) => {
        await window.__store?.getState().updateSettingsOrThrow({ theme })
      }, theme)
      await orcaPage.mouse.move(0, 0)
      await saveScreenshot(orcaPage, testInfo, `mixed-split-back-button-${theme}`)
    }

    // "Back to W1" returns the same PTY to a new W1 tab and leaves W2's tab with one pane.
    await backButton.click()
    await expect
      .poll(() => readTabPtyIds(orcaPage, host.tabId), { timeout: 15_000 })
      .toEqual([host.ptyId])
    await workspaceCard(orcaPage, w1.id).click()
    // Why :visible: other workspaces' tab strips stay mounted but hidden.
    const homeTab = orcaPage.locator(`${SORTABLE_TAB}:visible`)
    await expect(homeTab.and(orcaPage.locator(`[data-tab-id="${source.tabId}"]`))).toHaveCount(0)
    await expect(homeTab).toHaveCount(1)
    const homeTabId = await homeTab.getAttribute('data-tab-id')
    if (!homeTabId) {
      throw new Error('W1 home tab has no id')
    }
    await homeTab.click()
    await expect
      .poll(() => readTabPtyIds(orcaPage, homeTabId), { timeout: 15_000 })
      .toEqual([source.ptyId])
    const homeLeafId = (await readTabPanes(orcaPage, homeTabId))[0]!.leafId
    expect(await readLeafHome(orcaPage, homeTabId, homeLeafId)).toBeNull()
    await expect(
      paneHeaders(orcaPage, homeTabId).getByRole('button', { name: /^Back to / })
    ).toHaveCount(0)
    await expect(paneHeaders(orcaPage, homeTabId).locator('[data-pane-home-label]')).toHaveCount(0)
    await waitForPaneBuffer(orcaPage, homeTabId, homeLeafId, prepared.preMoveMarker)
    const homeMarker = ['BACK_HOME_', String(Date.now())] as const
    await typeIntoPane(orcaPage, homeTabId, homeLeafId, splitMarkerEchoCommand(...homeMarker))
    await waitForPaneBuffer(orcaPage, homeTabId, homeLeafId, homeMarker.join(''))
  })

  test('a sidebar agent row dropped on a pane is committed through the document drop capture', async ({
    orcaPage
  }) => {
    test.setTimeout(180_000)
    await orcaPage.evaluate(async () => {
      const settings = await window.api.settings.set({ agentsSidebarIntroShown: true })
      window.__store?.setState({ settings })
      const state = window.__store?.getState()
      if (state && !state.worktreeCardProperties.includes('inline-agents')) {
        state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
      }
    })
    const prepared = await prepareSourceAndHost(orcaPage)
    const sourceLeafId = (await readTabPanes(orcaPage, prepared.source.tabId))[0]?.leafId
    const prompt = `CROSS_WORKSPACE_AGENT_${Date.now()}`
    await orcaPage.evaluate(
      ({ paneKey, prompt }) => {
        const now = Date.now()
        window.__store
          ?.getState()
          .setAgentStatus(
            paneKey,
            { state: 'blocked', prompt, agentType: 'codex', lastAssistantMessage: 'Waiting.' },
            'Codex',
            { updatedAt: now, stateStartedAt: now }
          )
      },
      { paneKey: `${prepared.source.tabId}:${sourceLeafId}`, prompt }
    )
    const agentRow = workspaceCard(orcaPage, prepared.w1.id)
      .locator('.compact-agent-row[draggable="true"]')
      .filter({ hasText: prompt })
    await expect(agentRow).toBeVisible({ timeout: 15_000 })

    const dropPoint = await paneEdgePoint(
      orcaPage,
      prepared.host.tabId,
      prepared.host.leafId,
      'bottom'
    )
    // Why synthetic: CDP cannot start an OS drag session in a hidden window. The events still run
    // through every document capture listener, including the preload's native file-drop capture.
    await agentRow.evaluate((row, point) => {
      const dataTransfer = new DataTransfer()
      const init = (x: number, y: number): DragEventInit => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        dataTransfer
      })
      const rowBox = row.getBoundingClientRect()
      row.dispatchEvent(new DragEvent('dragstart', init(rowBox.x + 4, rowBox.y + 4)))
      const target = document.elementFromPoint(point.x, point.y)
      if (!target) {
        throw new Error('No element under the drop point')
      }
      target.dispatchEvent(new DragEvent('dragenter', init(point.x, point.y)))
      target.dispatchEvent(new DragEvent('dragover', init(point.x, point.y)))
      target.dispatchEvent(new DragEvent('drop', init(point.x, point.y)))
      row.dispatchEvent(new DragEvent('dragend', init(point.x, point.y)))
    }, dropPoint)

    const moved = await expectPaneJoinedHost(orcaPage, prepared)
    await expectMovedPaneIsLive(orcaPage, moved, 'ROW_DROP_LIVE')
  })
})

test('a mixed split and its home survive quit and relaunch with the pane still live', async (// oxlint-disable-next-line no-empty-pattern -- this test owns both Electron launches.
{}, testInfo) => {
  test.setTimeout(300_000)
  const repoPath = seededRepoPath()
  const session = createRestartSession(testInfo)
  const apps: ElectronApplication[] = []
  try {
    const first = await session.launch()
    apps.push(first.app)
    await first.page.setViewportSize({ width: 1400, height: 900 })
    await waitForSessionReady(first.page)
    await attachRepoAndOpenTerminal(first.page, repoPath)
    const moved = await dragW1CardIntoHost(first.page, await prepareSourceAndHost(first.page))
    await session.close(first.app)
    apps.pop()

    const second = await session.launch()
    apps.push(second.app)
    const page = second.page
    await page.setViewportSize({ width: 1400, height: 900 })
    await waitForSessionReady(page)
    await workspaceCard(page, moved.w2.id).click()
    await expect
      .poll(() => readTabPtyIds(page, moved.host.tabId), { timeout: 30_000 })
      .toEqual([moved.host.ptyId, moved.source.ptyId])
    expect(await readLeafHome(page, moved.host.tabId, moved.movedLeafId)).toBe(moved.w1.id)
    await expect(
      paneHeaders(page, moved.host.tabId).getByRole('button', {
        name: `Back to ${moved.w1.name}`
      })
    ).toHaveCount(1)
    await expectHomeLabel(page, moved.host.tabId, moved.w1.name)
    await waitForPaneBuffer(page, moved.host.tabId, moved.movedLeafId, moved.preMoveMarker, 30_000)
    await expect(page.getByRole('button', { name: /Reconnect/i })).toHaveCount(0)
    await expectMovedPaneIsLive(page, moved, 'RELAUNCH_LIVE')
  } finally {
    for (const app of apps.toReversed()) {
      await session.close(app).catch(() => undefined)
    }
    await session.dispose()
  }
})
