import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  commit,
  forkBeforeSilentDuplicate,
  forkOf,
  git,
  newRepo,
  release,
  SILENT_DUPLICATE
} from './git-fixtures.mjs'
import { runFunctions, tempDir } from './shell-harness.mjs'

function bundle(path, { signed = true, marker = 'old' } = {}) {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'marker'), marker)
  if (signed) {
    writeFileSync(join(path, 'signed'), '')
  }
}

function installFixture(t) {
  const dir = tempDir(t)
  bundle(join(dir, 'Applications/Orca.app'), { marker: 'installed' })
  bundle(join(dir, 'state/previous/Orca.app'), { marker: 'older backup' })
  writeFileSync(join(dir, 'state/installed-commit'), 'oldcommit\n')
  bundle(join(dir, 'state/staged/Orca.app'), { marker: 'legacy' })
  return dir
}

const install = (dir) =>
  runFunctions(
    dir,
    ['log', 'fail', 'remove_legacy_staged', 'wait_and_install'],
    `wait_and_install '${dir}/scratch/sync/staged/Orca.app' newcommit`
  )

function assertInstallRefused(dir, run) {
  assert.equal(run.status, 1)
  assert.equal(readFileSync(join(dir, 'Applications/Orca.app/marker'), 'utf8'), 'installed')
  assert.equal(readFileSync(join(dir, 'state/previous/Orca.app/marker'), 'utf8'), 'older backup')
  assert.equal(readFileSync(join(dir, 'state/installed-commit'), 'utf8'), 'oldcommit\n')
  assert.equal(readFileSync(join(dir, 'state/staged/Orca.app/marker'), 'utf8'), 'legacy')
  assert.match(
    readFileSync(join(dir, 'notifications'), 'utf8'),
    /staged build unavailable; next sync will rebuild/
  )
}

test('given the staged build vanished, the installed app and its backup are left untouched', (t) => {
  const dir = installFixture(t)
  assertInstallRefused(dir, install(dir))
})

test('given the staged build fails signature verification, the installed app is left untouched', (t) => {
  const dir = installFixture(t)
  bundle(join(dir, 'scratch/sync/staged/Orca.app'), { signed: false, marker: 'new' })
  assertInstallRefused(dir, install(dir))
})

test('given a valid staged build, it is installed and both the staged and legacy copies are removed', (t) => {
  const dir = installFixture(t)
  bundle(join(dir, 'scratch/sync/staged/Orca.app'), { marker: 'new' })
  const run = install(dir)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(join(dir, 'Applications/Orca.app/marker'), 'utf8'), 'new')
  assert.equal(readFileSync(join(dir, 'state/previous/Orca.app/marker'), 'utf8'), 'installed')
  assert.equal(readFileSync(join(dir, 'state/installed-commit'), 'utf8'), 'newcommit\n')
  assert.equal(existsSync(join(dir, 'state/staged')), false)
  assert.match(run.stderr, /Removing legacy staged build/)
  assert.equal(existsSync(join(dir, 'scratch/sync/staged')), false)
})

test('given a staged build retained from an earlier run, run data cleanup keeps it', (t) => {
  const dir = tempDir(t)
  bundle(join(dir, 'scratch/sync/staged/Orca.app'), { marker: 'retained' })
  mkdirSync(join(dir, 'scratch/sync/upstream/node_modules'), { recursive: true })
  mkdirSync(join(dir, 'scratch/sync/tmp/work'), { recursive: true })
  writeFileSync(join(dir, 'scratch/sync/fork-tests.json'), '{}')
  writeFileSync(join(dir, 'scratch/sync/fork-tests.log'), '')
  const run = runFunctions(dir, ['cleanup_run_data'], 'cleanup_run_data')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(join(dir, 'scratch/sync/staged/Orca.app/marker'), 'utf8'), 'retained')
  for (const leftover of ['upstream', 'tmp', 'fork-tests.json', 'fork-tests.log']) {
    assert.equal(existsSync(join(dir, 'scratch/sync', leftover)), false, leftover)
  }
})

const stage = (dir, { stagedDir = `${dir}/scratch/sync/staged`, before = '' } = {}) =>
  runFunctions(
    dir,
    ['log', 'fail', 'stage_build'],
    `${before}STAGED_DIR='${stagedDir}'; stage_build '${dir}/dist/Orca.app'`
  )

function stagingFixture(t) {
  const dir = tempDir(t)
  bundle(join(dir, 'state/staged/Orca.app'), { marker: 'legacy' })
  bundle(join(dir, 'scratch/sync/staged/Orca.app'), { marker: 'previous' })
  return dir
}

function assertStagingRefused(dir, run) {
  assert.equal(run.status, 1)
  assert.equal(readFileSync(join(dir, 'scratch/sync/staged/Orca.app/marker'), 'utf8'), 'previous')
  assert.equal(readFileSync(join(dir, 'state/staged/Orca.app/marker'), 'utf8'), 'legacy')
  assert.deepEqual(readdirSync(join(dir, 'scratch/sync/staged')), ['Orca.app'])
}

test('given a verified new build, it replaces the staged build and the legacy copy waits for the install', (t) => {
  const dir = stagingFixture(t)
  bundle(join(dir, 'dist/Orca.app'), { marker: 'new' })
  const run = stage(dir)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(join(dir, 'scratch/sync/staged/Orca.app/marker'), 'utf8'), 'new')
  assert.deepEqual(readdirSync(join(dir, 'scratch/sync/staged')), ['Orca.app'])
  assert.equal(readFileSync(join(dir, 'state/staged/Orca.app/marker'), 'utf8'), 'legacy')
})

test('given the verified build cannot be moved into place, the previous staged build is restored', (t) => {
  const dir = stagingFixture(t)
  bundle(join(dir, 'dist/Orca.app'), { marker: 'new' })
  const failingMove = 'mv() { if [[ "$1" == *.new ]]; then return 1; fi; command mv "$@"; }; '
  assertStagingRefused(dir, stage(dir, { before: failingMove }))
})

test('given the new build cannot be copied, the previous staged build and legacy copy are kept', (t) => {
  const dir = stagingFixture(t)
  assertStagingRefused(dir, stage(dir))
})

test('given the copied build fails signature verification, the previous staged build and legacy copy are kept', (t) => {
  const dir = stagingFixture(t)
  bundle(join(dir, 'dist/Orca.app'), { signed: false, marker: 'new' })
  assertStagingRefused(dir, stage(dir))
})

test('given staging falls back to the state dir, the new build replaces the old one there', (t) => {
  const dir = tempDir(t)
  bundle(join(dir, 'state/staged/Orca.app'), { marker: 'legacy' })
  bundle(join(dir, 'dist/Orca.app'), { marker: 'new' })
  const run = stage(dir, { stagedDir: `${dir}/state/staged` })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(join(dir, 'state/staged/Orca.app/marker'), 'utf8'), 'new')
})

test('given a release retagged onto a new commit with the same lockfile, the baseline key changes', (t) => {
  const dir = tempDir(t)
  const repo = join(dir, 'repo')
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.com'
  }
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env })
  mkdirSync(repo)
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  git('add', 'pnpm-lock.yaml')
  git('commit', '-q', '-m', 'release')
  git('update-ref', 'refs/upstream-tags/v1.0.0', 'HEAD')
  const key = () => {
    const run = runFunctions(
      dir,
      ['upstream_baseline_key'],
      `latest=v1.0.0; latest_ref=refs/upstream-tags/v1.0.0; UPSTREAM_ROOT='${dir}/upstream'; cd '${repo}'; upstream_baseline_key`
    )
    assert.equal(run.status, 0, run.stderr)
    return run.stdout.trim()
  }
  const original = key()
  git('commit', '-q', '--allow-empty', '-m', 'retagged release')
  git('update-ref', 'refs/upstream-tags/v1.0.0', 'HEAD')
  assert.match(original, /^[0-9a-f]{16}$/)
  assert.notEqual(key(), original)
})

const prepareBuildOutput = (dir, runDir = `${dir}/scratch/sync`) =>
  runFunctions(dir, ['prepare_build_output'], `RUN_DIR='${runDir}'; prepare_build_output`)

test('given scratch is active, dist becomes a symlink to a fresh scratch build dir', (t) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'state/repo/dist'), { recursive: true })
  writeFileSync(join(dir, 'state/repo/dist/stale'), '')
  mkdirSync(join(dir, 'scratch/sync/build/dist'), { recursive: true })
  writeFileSync(join(dir, 'scratch/sync/build/dist/stale'), '')
  const run = prepareBuildOutput(dir)
  assert.equal(run.status, 0, run.stderr)
  assert.ok(lstatSync(join(dir, 'state/repo/dist')).isSymbolicLink())
  assert.equal(readlinkSync(join(dir, 'state/repo/dist')), `${dir}/scratch/sync/build/dist`)
  assert.deepEqual(readdirSync(join(dir, 'scratch/sync/build/dist')), [])
})

test('given a dist symlink left by an earlier run, preparing never deletes through it', (t) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'state/repo'), { recursive: true })
  mkdirSync(join(dir, 'elsewhere'))
  writeFileSync(join(dir, 'elsewhere/keep'), 'kept')
  symlinkSync(join(dir, 'elsewhere'), join(dir, 'state/repo/dist'))
  const run = prepareBuildOutput(dir)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(join(dir, 'elsewhere/keep'), 'utf8'), 'kept')
  assert.equal(readlinkSync(join(dir, 'state/repo/dist')), `${dir}/scratch/sync/build/dist`)
})

test('given staging falls back to the state dir, dist is only cleared as before', (t) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'state/repo/dist'), { recursive: true })
  writeFileSync(join(dir, 'state/repo/dist/stale'), '')
  const run = prepareBuildOutput(dir, `${dir}/state`)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(existsSync(join(dir, 'state/repo/dist')), false)
  assert.equal(existsSync(join(dir, 'state/build')), false)
})

test('given a build wrote through the dist symlink, run data cleanup removes the link and the scratch build', (t) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'state/repo'), { recursive: true })
  mkdirSync(join(dir, 'scratch/sync/build/dist/mac-arm64'), { recursive: true })
  symlinkSync(join(dir, 'scratch/sync/build/dist'), join(dir, 'state/repo/dist'))
  const run = runFunctions(dir, ['cleanup_run_data'], 'cleanup_run_data')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(existsSync(join(dir, 'scratch/sync/build')), false)
  assert.throws(() => lstatSync(join(dir, 'state/repo/dist')), { code: 'ENOENT' })
})

test('given staging falls back to the state dir, run data cleanup leaves a real dist alone', (t) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'state/repo/dist/mac-arm64'), { recursive: true })
  const run = runFunctions(dir, ['cleanup_run_data'], `RUN_DIR='${dir}/state'; cleanup_run_data`)
  assert.equal(run.status, 0, run.stderr)
  assert.ok(existsSync(join(dir, 'state/repo/dist/mac-arm64')))
})

const RESOLVER = fileURLToPath(new URL('./resolve-untouched-conflicts.mjs', import.meta.url))

// Runs the script's merge step in a fork clone that has a pre-commit hook and a
// Claude stand-in that only records being called.
function mergeRelease(t, repo, preMerge) {
  const dir = tempDir(t)
  writeFileSync(
    join(repo, '.git/hooks/pre-commit'),
    '#!/bin/sh\ntouch "$(git rev-parse --git-dir)/pre-commit-ran"\n',
    { mode: 0o755 }
  )
  const run = runFunctions(
    dir,
    ['log', 'fail', 'merge_upstream_release'],
    [
      `run_claude() { touch '${dir}/claude-called'; return 1; }`,
      `RESOLVE_UNTOUCHED='${RESOLVER}' REPO='${repo}' BRANCH=fork`,
      `latest=v1.1.0 latest_ref=refs/upstream-tags/v1.1.0 pre_merge=${preMerge}`,
      `cd '${repo}'`,
      'merge_upstream_release'
    ].join('\n')
  )
  return { run, claudeCalled: existsSync(join(dir, 'claude-called')) }
}

function assertMergeCommitted(repo, run) {
  assert.equal(run.status, 0, run.stderr)
  assert.equal(git(repo, 'log', '-1', '--format=%s'), 'chore(fork): merge upstream v1.1.0')
  assert.equal(git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3)
  assert.equal(git(repo, 'status', '--porcelain'), '')
  assert.ok(existsSync(join(repo, '.git/pre-commit-ran')), 'the pre-commit hook ran')
}

test('given a clean merge that silently duplicated a block in an untouched file, the merge commit carries the upstream version', (t) => {
  const { repo, preMerge } = forkBeforeSilentDuplicate(t)
  const { run, claudeCalled } = mergeRelease(t, repo, preMerge)
  assertMergeCommitted(repo, run)
  assert.equal(readFileSync(join(repo, 'ready.ts'), 'utf8'), SILENT_DUPLICATE.upstream)
  assert.equal(readFileSync(join(repo, 'patched.txt'), 'utf8'), SILENT_DUPLICATE.patchedMerged)
  assert.match(
    run.stderr,
    /Restored upstream v1\.1\.0 for files the fork never modified: backport\.txt ready\.ts/
  )
  assert.equal(claudeCalled, false)
})

test('given conflicts only in files the fork never modified, the merge is committed without Claude', (t) => {
  const upstream = newRepo(t)
  commit(upstream, { 'shared.txt': 'base\n' }, 'base')
  git(upstream, 'checkout', '-q', '-b', 'release')
  commit(upstream, { 'shared.txt': 'release\n' }, 'release fix')
  release(upstream, 'v1.0.0')
  git(upstream, 'checkout', '-q', 'main')
  commit(upstream, { 'shared.txt': 'upstream next\n' }, 'next release')
  release(upstream, 'v1.1.0')
  const repo = forkOf(t, upstream, 'v1.0.0')
  const preMerge = commit(repo, { 'fork.txt': 'fork\n' }, 'fork patch')
  const { run, claudeCalled } = mergeRelease(t, repo, preMerge)
  assertMergeCommitted(repo, run)
  assert.equal(readFileSync(join(repo, 'shared.txt'), 'utf8'), 'upstream next\n')
  assert.match(run.stderr, /skipping the Claude session/)
  assert.equal(claudeCalled, false)
})

test('given the upstream worktree cannot be created, no tests run and the baseline fails', (t) => {
  const dir = tempDir(t)
  const run = runFunctions(
    dir,
    ['upstream_report'],
    [
      `mkdir -p '${dir}/state/repo' && cd '${dir}/state/repo'`,
      `latest=v1.1.0; latest_ref=refs/upstream-tags/v1.1.0; UPSTREAM_ROOT='${dir}/scratch/sync/upstream'; COMPARE=/dev/null`,
      'log() { :; }',
      'upstream_baseline_key() { echo key; }',
      'step_limits() { echo "60 60"; }',
      `run_step() { echo ran-step >> '${dir}/calls'; }`,
      `run_unit_tests() { echo ran-tests >> '${dir}/calls'; }`,
      'git() { if [[ "$1" == worktree && "$2" == add ]]; then return 1; fi; return 0; }',
      'if upstream_report; then echo "status=ok"; else echo "status=failed"; fi',
      'echo "cwd=$PWD"'
    ].join('\n')
  )
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /status=failed/)
  assert.match(run.stdout, new RegExp(`cwd=.*${dir.split('/').pop()}/state/repo$`, 'm'))
  assert.throws(() => readFileSync(join(dir, 'calls'), 'utf8'))
})
