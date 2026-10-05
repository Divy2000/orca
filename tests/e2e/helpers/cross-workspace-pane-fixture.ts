/**
 * Drives cross-workspace terminal pane moves the way a user does: the seeded repo's two
 * workspaces, a sidebar workspace-card pointer drag onto a pane edge, and per-pane reads.
 */

import path from 'node:path'
import { expect, type Page } from '@stablyai/playwright-test'
import { runProcess } from '../../../src/shared/child-process/run-process'
import type { RuntimeTerminalSummary } from '../../../src/shared/runtime-types'
import { ensureTerminalVisible, switchToWorktree } from './store'
import { waitForActivePanePtyId, waitForActiveTerminalManager } from './terminal'

export type SeededWorkspace = { id: string; name: string }

export type TerminalPaneDom = { leafId: string; ptyId: string | null }

export type PaneEdge = 'left' | 'right' | 'top' | 'bottom'

type SeededWorkspacePair = { w1: SeededWorkspace; w2: SeededWorkspace }

/** The seeded repo's primary worktree (W1) and its `e2e-secondary` worktree (W2). */
export async function resolveSeededWorkspaces(page: Page): Promise<SeededWorkspacePair> {
  let pair: SeededWorkspacePair | null = null
  // Why poll: a freshly attached repo can publish its primary worktree before the secondary one.
  await expect
    .poll(
      async () => {
        pair = await page.evaluate(async () => {
          const store = window.__store
          const activeId = store?.getState().activeWorktreeId
          const primary = Object.values(store?.getState().worktreesByRepo ?? {})
            .flat()
            .find((worktree) => worktree.id === activeId)
          if (!store || !primary) {
            return null
          }
          await store.getState().fetchWorktrees(primary.repoId)
          const secondary = (store.getState().worktreesByRepo[primary.repoId] ?? []).find(
            (worktree) =>
              !worktree.isMainWorktree &&
              worktree.branch.replace(/^refs\/heads\//, '') === 'e2e-secondary'
          )
          if (!secondary) {
            return null
          }
          const label = (worktree: typeof primary): string =>
            worktree.displayName || worktree.branch.replace(/^refs\/heads\//, '')
          return {
            w1: { id: primary.id, name: label(primary) },
            w2: { id: secondary.id, name: label(secondary) }
          }
        })
        return pair !== null
      },
      { timeout: 30_000, message: 'Expected the seeded primary and e2e-secondary worktrees' }
    )
    .toBe(true)
  if (!pair) {
    throw new Error('resolveSeededWorkspaces: worktrees disappeared after resolving')
  }
  return pair
}

/** Activates the workspace's terminal surface and returns its active terminal tab and PTY. */
export async function openWorkspaceTerminal(
  page: Page,
  worktreeId: string
): Promise<{ tabId: string; ptyId: string }> {
  await switchToWorktree(page, worktreeId)
  await expect
    .poll(() => page.evaluate(() => window.__store?.getState().activeWorktreeId ?? null))
    .toBe(worktreeId)
  await ensureTerminalVisible(page, 30_000)
  await waitForActiveTerminalManager(page, 30_000)
  const ptyId = await waitForActivePanePtyId(page, 30_000)
  const tabId = await page.evaluate(
    (id) => window.__store?.getState().activeTabIdByWorktree[id] ?? null,
    worktreeId
  )
  if (!tabId) {
    throw new Error(`Workspace ${worktreeId} has no active terminal tab`)
  }
  return { tabId, ptyId }
}

export function terminalSurface(page: Page, tabId: string) {
  return page.locator(`div[data-terminal-tab-id=${JSON.stringify(tabId)}]:not(.pane-title-bar)`)
}

/** The pane header bars of a terminal tab, rendered as siblings of its surface. */
export function paneHeaders(page: Page, tabId: string) {
  return page.locator(`.pane-title-bar[data-terminal-tab-id=${JSON.stringify(tabId)}]`)
}

export function workspaceCard(page: Page, worktreeId: string) {
  return page.locator(
    `[data-worktree-sidebar] [role="option"][data-worktree-id=${JSON.stringify(worktreeId)}]`
  )
}

/** Panes rendered in a terminal tab, in DOM order, with the PTY each is bound to. */
export async function readTabPanes(page: Page, tabId: string): Promise<TerminalPaneDom[]> {
  return terminalSurface(page, tabId)
    .locator('.pane[data-leaf-id]')
    .evaluateAll((panes) =>
      panes.map((pane) => ({
        leafId: pane instanceof HTMLElement ? (pane.dataset.leafId ?? '') : '',
        ptyId: pane instanceof HTMLElement ? (pane.dataset.ptyId ?? null) : null
      }))
    )
}

/** The rendered text of one pane, read through the pane manager's serialize addon. */
export async function readPaneBuffer(page: Page, tabId: string, leafId: string): Promise<string> {
  return page.evaluate(
    ({ tabId, leafId }) => {
      const manager = window.__paneManagers?.get(tabId)
      const pane = manager?.getPanes().find((candidate) => candidate.leafId === leafId)
      return pane?.serializeAddon?.serialize?.() ?? ''
    },
    { tabId, leafId }
  )
}

export async function waitForPaneBuffer(
  page: Page,
  tabId: string,
  leafId: string,
  expected: string,
  timeoutMs = 20_000
): Promise<void> {
  await expect
    .poll(async () => (await readPaneBuffer(page, tabId, leafId)).includes(expected), {
      timeout: timeoutMs,
      message: `Pane ${leafId} never printed "${expected}"`
    })
    .toBe(true)
}

/** Clicks into the pane like a user, then types a command into its xterm input. */
export async function typeIntoPane(
  page: Page,
  tabId: string,
  leafId: string,
  command: string
): Promise<void> {
  const pane = terminalSurface(page, tabId).locator(
    `.pane[data-leaf-id=${JSON.stringify(leafId)}] .xterm-screen`
  )
  await pane.click({ position: { x: 40, y: 60 } })
  // Why: hidden test windows never hold OS focus, so pin focus on the pane's own input.
  await pane
    .locator('xpath=ancestor::*[contains(@class,"pane")][1]')
    .locator('.xterm-helper-textarea')
    .focus()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** The point inside a pane whose nearest edge is `edge`. */
export async function paneEdgePoint(
  page: Page,
  tabId: string,
  leafId: string,
  edge: PaneEdge
): Promise<{ x: number; y: number }> {
  const box = await terminalSurface(page, tabId)
    .locator(`.pane[data-leaf-id=${JSON.stringify(leafId)}]`)
    .boundingBox()
  if (!box) {
    throw new Error(`Pane ${leafId} has no layout box`)
  }
  const inset = 24
  const midX = box.x + box.width / 2
  const midY = box.y + box.height / 2
  switch (edge) {
    case 'left':
      return { x: box.x + inset, y: midY }
    case 'right':
      return { x: box.x + box.width - inset, y: midY }
    case 'top':
      return { x: midX, y: box.y + inset }
    case 'bottom':
      return { x: midX, y: box.y + box.height - inset }
  }
}

/**
 * Real pointer drag of a sidebar workspace card onto a point. `whileOver` runs with the pointer
 * held over the target, before release.
 */
export async function dragWorkspaceCardTo(
  page: Page,
  worktreeId: string,
  point: { x: number; y: number },
  whileOver?: () => Promise<void>
): Promise<void> {
  const card = workspaceCard(page, worktreeId)
  await expect(card).toBeVisible()
  const box = await card.boundingBox()
  if (!box) {
    throw new Error(`Workspace card ${worktreeId} has no layout box`)
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  try {
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 4, { steps: 3 })
    await page.mouse.move(point.x, point.y, { steps: 16 })
    await page.mouse.move(point.x + 1, point.y, { steps: 2 })
    await whileOver?.()
  } finally {
    await page.mouse.up()
  }
}

/** `orca terminal list --json` against this app's isolated profile, through the dev CLI. */
export async function listTerminalsWithCli(
  userDataDir: string,
  worktreeId?: string
): Promise<RuntimeTerminalSummary[]> {
  const repoRoot = process.cwd()
  const args = [path.join(repoRoot, 'config', 'scripts', 'orca-dev.mjs'), 'terminal', 'list']
  if (worktreeId) {
    args.push('--worktree', `id:${worktreeId}`)
  }
  args.push('--json')
  const { code, stdout, stderr } = await runProcess({
    program: process.execPath,
    args,
    cwd: repoRoot,
    env: { ...process.env, ORCA_DEV_USER_DATA_PATH: userDataDir },
    timeoutMs: 30_000
  })
  if (code !== 0) {
    throw new Error(`orca terminal list exited ${code}: ${stderr || stdout}`)
  }
  const parsed: unknown = JSON.parse(stdout)
  const terminals: unknown =
    typeof parsed === 'object' && parsed !== null
      ? Reflect.get(Reflect.get(parsed, 'result') ?? {}, 'terminals')
      : undefined
  if (!Array.isArray(terminals)) {
    throw new Error(`Unexpected terminal list output: ${stdout}`)
  }
  return terminals
}
