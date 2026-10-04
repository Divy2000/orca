import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { translate } from '@/i18n/i18n'
import type { TerminalLeafHome } from '../../../../shared/terminal-tab-types'
import { getNotificationWorkspaceLabels } from './terminal-notification-state'
import {
  findDetectedTerminalHomeRow,
  isCatalogTerminalHome,
  resolveTerminalPaneHomeStatus
} from './terminal-pane-home-validity'

function homeWorkspaceLabel(state: AppState, worktreeId: string, fallback: string): string {
  // Why existence, not label equality: a workspace may literally be named like the fallback.
  if (isCatalogTerminalHome(state, worktreeId)) {
    return getNotificationWorkspaceLabels(state, worktreeId, fallback).worktreeLabel
  }
  const detected = findDetectedTerminalHomeRow(state, worktreeId)
  return detected?.displayName || detected?.branch || fallback
}

/** Home workspace names of the leaves hosted from another workspace, keyed by leaf id. */
export function resolveTerminalPaneHomeLabels(
  state: AppState,
  homeByLeafId: Readonly<Record<string, TerminalLeafHome>> | undefined,
  hostWorktreeId: string
): Readonly<Record<string, string>> {
  const fallback = translate(
    'auto.components.terminal.pane.terminalPaneHome.itsWorkspace',
    'its workspace'
  )
  return Object.fromEntries(
    Object.entries(homeByLeafId ?? {})
      .filter(
        ([, home]) =>
          home.worktreeId !== hostWorktreeId &&
          resolveTerminalPaneHomeStatus(state, hostWorktreeId, home.worktreeId) === 'reachable'
      )
      .map(([leafId, home]) => [leafId, homeWorkspaceLabel(state, home.worktreeId, fallback)])
  )
}

/** The labels as one JSON string, so a store listener re-renders only when a label changes. */
export function selectTerminalPaneHomeLabelsKey(
  state: AppState,
  tabId: string,
  hostWorktreeId: string
): string {
  const homeByLeafId = state.terminalLayoutsByTabId[tabId]?.homeByLeafId
  if (!homeByLeafId) {
    return ''
  }
  const entries = Object.entries(resolveTerminalPaneHomeLabels(state, homeByLeafId, hostWorktreeId))
  return entries.length > 0 ? JSON.stringify(entries) : ''
}

function isLabelEntry(entry: unknown): entry is [string, string] {
  return (
    Array.isArray(entry) &&
    entry.length === 2 &&
    typeof entry[0] === 'string' &&
    typeof entry[1] === 'string'
  )
}

export function parseTerminalPaneHomeLabelsKey(key: string): Readonly<Record<string, string>> {
  const entries: unknown = key ? JSON.parse(key) : []
  return Object.fromEntries(Array.isArray(entries) ? entries.filter(isLabelEntry) : [])
}

// Why one keyed selector: homes follow both the layout and the workspace catalog (rename, delete,
// detection), and every mounted pane pays per listener on each store publication.
export function useTerminalPaneHomeLabels(
  tabId: string,
  hostWorktreeId: string
): Readonly<Record<string, string>> {
  const key = useAppStore((state) => selectTerminalPaneHomeLabelsKey(state, tabId, hostWorktreeId))
  return useMemo(() => parseTerminalPaneHomeLabelsKey(key), [key])
}
