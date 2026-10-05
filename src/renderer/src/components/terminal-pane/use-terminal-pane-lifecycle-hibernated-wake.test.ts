// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IDisposable } from '@xterm/xterm'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import type { ResumeSleepingAgentSessionsOptions } from '@/lib/resume-sleeping-agent-session'
import type { UseTerminalPaneLifecycleDeps } from './terminal-pane-lifecycle-types'

const W1 = 'repo-1::/work/w1'
const W2 = 'repo-1::/work/w2'
const W3 = 'repo-1::/work/w3'
const HOST_TAB = 'tab-w2'
const NATIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FOREIGN_LEAF = '22222222-2222-4222-8222-222222222222'

type SleepingRecord = { worktreeId: string; paneKey: string; tabId?: string; claimKey: string }

let sleepingRecords: Record<string, SleepingRecord> = {}
let tabsByWorktree: Record<string, { id: string }[]> = {}
let terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot> = {}
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      sleepingAgentSessionsByPaneKey: sleepingRecords,
      tabsByWorktree,
      terminalLayoutsByTabId,
      clearSleepingAgentSessionsByPaneKey: () => {}
    })
  }
}))

// Why: the in-place wake and the background-mount path partition records by
// provider-session claim; model every record as a passive completed hibernation.
vi.mock('@/lib/sleeping-agent-pane-ownership', () => ({
  activationTreatsNoteAsFinished: () => true,
  recordPaneIsOwnedByPreservedPane: () => false,
  getProviderSessionClaimKey: (record: SleepingRecord) => record.claimKey
}))

const resumeSpy = vi.fn<
  (worktreeId: string, options?: ResumeSleepingAgentSessionsOptions) => number
>(() => 0)
vi.mock('@/lib/resume-sleeping-agent-session', () => ({
  resumeSleepingAgentSessionsForWorktree: (
    worktreeId: string,
    options?: ResumeSleepingAgentSessionsOptions
  ) => resumeSpy(worktreeId, options)
}))

const backgroundMountSpy = vi.fn()
vi.mock('@/components/terminal/background-terminal-worktree-mount', () => ({
  requestBackgroundTerminalWorktreeMount: (detail: unknown) => backgroundMountSpy(detail)
}))

vi.mock('./use-terminal-pane-mount-lifecycle', () => ({
  useTerminalPaneMountLifecycle: () => {}
}))

import { wakeSleepingAgentsForWorktreeInBackground } from '@/lib/wake-sleeping-agents-in-background'
import { useTerminalPaneLifecycle } from './use-terminal-pane-lifecycle'

const hostLayout: TerminalLayoutSnapshot = {
  root: {
    type: 'split',
    direction: 'vertical',
    first: { type: 'leaf', leafId: NATIVE_LEAF },
    second: { type: 'leaf', leafId: FOREIGN_LEAF }
  },
  activeLeafId: NATIVE_LEAF,
  expandedLeafId: null,
  homeByLeafId: {
    [FOREIGN_LEAF]: { worktreeId: W1, sessionTabId: 'tab-w1', sessionLeafId: FOREIGN_LEAF }
  }
}

function armedBinding(claimKey: string | null) {
  return { dispose: vi.fn(), wakeHibernatedAgentIfArmed: vi.fn(() => claimKey) }
}

function mountHostTab(bindings: { native: IDisposable; foreign: IDisposable }) {
  const leafIdByPaneId = new Map([
    [1, NATIVE_LEAF],
    [2, FOREIGN_LEAF]
  ])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test-only stub; with the mount lifecycle mocked out, the hook reads only these deps and manager members.
  const deps = {
    tabId: HOST_TAB,
    worktreeId: W2,
    isActive: false,
    isVisible: false,
    systemPrefersDark: false,
    settings: undefined,
    settingsRef: { current: undefined },
    managerRef: {
      current: {
        getLeafId: (paneId: number) => leafIdByPaneId.get(paneId) ?? null,
        getPanes: () => [],
        getActivePane: () => null,
        setTerminalGpuAcceleration: () => {}
      }
    },
    panePtyBindingsRef: {
      current: new Map<number, IDisposable>([
        [1, bindings.native],
        [2, bindings.foreign]
      ])
    },
    isVisibleRef: { current: false }
  } as unknown as UseTerminalPaneLifecycleDeps
  return renderHook(() => useTerminalPaneLifecycle(deps))
}

beforeEach(() => {
  tabsByWorktree = { [W2]: [{ id: HOST_TAB }], [W3]: [{ id: 'tab-w3' }] }
  terminalLayoutsByTabId = { [HOST_TAB]: hostLayout }
  sleepingRecords = {
    native: {
      worktreeId: W2,
      paneKey: `${HOST_TAB}:${NATIVE_LEAF}`,
      tabId: HOST_TAB,
      claimKey: 'claim-native'
    },
    foreign: {
      worktreeId: W1,
      paneKey: `${HOST_TAB}:${FOREIGN_LEAF}`,
      tabId: HOST_TAB,
      claimKey: 'claim-foreign'
    },
    other: {
      worktreeId: W3,
      paneKey: 'tab-w3:33333333-3333-4333-8333-333333333333',
      tabId: 'tab-w3',
      claimKey: 'claim-other'
    }
  }
  resumeSpy.mockClear()
  backgroundMountSpy.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('useTerminalPaneLifecycle hibernated wake', () => {
  it('given a background wake of the home workspace then the mounted foreign pane wakes in place, once', () => {
    const native = armedBinding('claim-native')
    const foreign = armedBinding('claim-foreign')
    mountHostTab({ native, foreign })

    wakeSleepingAgentsForWorktreeInBackground(W1)

    expect(foreign.wakeHibernatedAgentIfArmed).toHaveBeenCalledOnce()
    expect(native.wakeHibernatedAgentIfArmed).not.toHaveBeenCalled()
    expect(backgroundMountSpy).not.toHaveBeenCalled()
    expect(resumeSpy.mock.calls[0]?.[1]?.skipClaimKeys).toEqual(new Set(['claim-foreign']))
  })

  it('given a background wake of the host workspace then only its native pane wakes in place, once', () => {
    const native = armedBinding('claim-native')
    const foreign = armedBinding('claim-foreign')
    mountHostTab({ native, foreign })

    wakeSleepingAgentsForWorktreeInBackground(W2)

    expect(native.wakeHibernatedAgentIfArmed).toHaveBeenCalledOnce()
    expect(foreign.wakeHibernatedAgentIfArmed).not.toHaveBeenCalled()
    expect(backgroundMountSpy).not.toHaveBeenCalled()
    expect(resumeSpy.mock.calls[0]?.[1]?.skipClaimKeys).toEqual(new Set(['claim-native']))
  })

  it('given a background wake of an unrelated workspace then no mounted pane wakes', () => {
    const native = armedBinding('claim-native')
    const foreign = armedBinding('claim-foreign')
    mountHostTab({ native, foreign })

    wakeSleepingAgentsForWorktreeInBackground(W3)

    expect(native.wakeHibernatedAgentIfArmed).not.toHaveBeenCalled()
    expect(foreign.wakeHibernatedAgentIfArmed).not.toHaveBeenCalled()
    expect(backgroundMountSpy).toHaveBeenCalledWith({ worktreeId: W3, tabIds: ['tab-w3'] })
  })

  it('given the mounted pane does not consume the wake then the background mount still targets its tab', () => {
    const native = armedBinding(null)
    const foreign = armedBinding('claim-foreign')
    mountHostTab({ native, foreign })

    wakeSleepingAgentsForWorktreeInBackground(W2)

    expect(native.wakeHibernatedAgentIfArmed).toHaveBeenCalledOnce()
    expect(backgroundMountSpy).toHaveBeenCalledWith({ worktreeId: W2, tabIds: [HOST_TAB] })
    expect(resumeSpy.mock.calls[0]?.[1]?.skipClaimKeys).toEqual(new Set())
  })

  it('given the tab unmounted then a background wake no longer reaches its panes', () => {
    const native = armedBinding('claim-native')
    const foreign = armedBinding('claim-foreign')
    mountHostTab({ native, foreign }).unmount()

    wakeSleepingAgentsForWorktreeInBackground(W2)

    expect(native.wakeHibernatedAgentIfArmed).not.toHaveBeenCalled()
    expect(backgroundMountSpy).toHaveBeenCalledWith({ worktreeId: W2, tabIds: [HOST_TAB] })
  })
})
