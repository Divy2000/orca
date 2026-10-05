// Runs functions from orca-fork-sync.sh under the launchd shell (/bin/bash 3.2)
// for the fork-sync tests.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = readFileSync(new URL('./orca-fork-sync.sh', import.meta.url), 'utf8')

export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fork-sync-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function shellFunction(name) {
  const match = SCRIPT.match(
    new RegExp(`^${name}\\(\\) \\{(?:[^\\n]*\\}$|\\n[\\s\\S]*?^\\}$)`, 'm')
  )
  assert.ok(match, `orca-fork-sync.sh defines ${name}()`)
  return match[0]
}

// Runs the script's own functions under the launchd shell with the system
// tools that touch the desktop stubbed out. A bundle counts as validly
// signed when it holds a "signed" marker file.
export function harnessScript(dir, names, call) {
  return [
    'set -euo pipefail',
    `STATE_DIR='${dir}/state'`,
    `REPO='${dir}/state/repo'`,
    `RUN_DIR='${dir}/scratch/sync'`,
    `UPSTREAM_WORKTREE='${dir}/scratch/sync/upstream'`,
    `FORK_REPORT='${dir}/scratch/sync/fork-tests.json'`,
    `RETRY_REPORT='${dir}/scratch/sync/fork-retry.json'`,
    `STAGED_DIR='${dir}/scratch/sync/staged'`,
    `INTERNAL_TEST_DIR='${dir}/state/test-run'`,
    `SCRATCH_TEST_DIR='${dir}/scratch/sync/test-run'`,
    `TEST_RUN_DIR='${dir}/state/test-run'`,
    'TEST_SCOPE=full RELATED_FORK_SOURCES= RELATED_UPSTREAM_SOURCES=',
    `APP_PATH='${dir}/Applications/Orca.app'`,
    `LOG_FILE='${dir}/sync.log'`,
    'INSTALL_WAIT_SECONDS=60',
    `notify() { printf '%s: %s\\n' "$1" "$2" >> '${dir}/notifications'; }`,
    'orca_running() { return 1; }',
    'codesign() { local bundle; for bundle; do :; done; [[ -f "$bundle/signed" ]]; }',
    'open() { :; }',
    ...names.map(shellFunction),
    call
  ].join('\n')
}

export function runFunctions(dir, names, call, options = {}) {
  return spawnSync('/bin/bash', ['-c', harnessScript(dir, names, call)], {
    encoding: 'utf8',
    ...options
  })
}
