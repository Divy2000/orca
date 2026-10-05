import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { commit, git } from './git-fixtures.mjs'
import { runFunctions, tempDir } from './shell-harness.mjs'

const COMPARE = fileURLToPath(new URL('./compare-test-failures.mjs', import.meta.url))
const readOr = (path, fallback = '') => (existsSync(path) ? readFileSync(path, 'utf8') : fallback)

// Runs verify() the way the job does (inside `if`, so errexit is off) with its
// steps stubbed. `scenario` names the one thing that goes wrong.
function verifyWith(t, scenario) {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'scratch/sync'), { recursive: true })
  const run = runFunctions(
    dir,
    ['log', 'fail', 'verify'],
    [
      `SCENARIO=${scenario} latest=v1.1.0 UPSTREAM_ROOT='${dir}/upstream'`,
      `COMPARE=compare INTRODUCED_FILE='${dir}/introduced.txt'`,
      'step_limits() { echo "60 60"; }',
      'run_logged_step() { [[ "$SCENARIO" != "step:$1" ]]; }',
      'select_test_scope() { [[ "$SCENARIO" != select ]]; }',
      'nothing_to_test() { return 1; }',
      `upstream_report() { [[ "$SCENARIO" != upstream ]] && UPSTREAM_BASELINE='${dir}/up.json'; }`,
      'run_scoped_tests() { [[ "$SCENARIO" == no-fork-report ]] || echo \'{"testResults":[]}\' > "$2"; }',
      'run_unit_tests() { echo \'{"testResults":[]}\' > "$1"; }',
      'node() {',
      '  if [[ "$1" == --test ]]; then [[ "$SCENARIO" != self-tests ]]; return; fi',
      '  if [[ "$SCENARIO" == introduced ]]; then echo "test/x.test.ts > breaks"; return 1; fi',
      '}',
      'if verify; then echo "verify returned 0"; else echo "verify returned $?"; fi'
    ].join('\n')
  )
  return { run, notifications: readOr(join(dir, 'notifications')) }
}

test('given a passing gate, verify succeeds', (t) => {
  const { run } = verifyWith(t, 'none')
  assert.equal(run.stdout.trim(), 'verify returned 0', run.stderr)
})

test('given a failing typecheck or introduced test failures, verify asks for a repair', (t) => {
  for (const scenario of ['step:typecheck', 'introduced']) {
    const { run, notifications } = verifyWith(t, scenario)
    assert.equal(run.stdout.trim(), 'verify returned 1', `${scenario}: ${run.stderr}`)
    assert.equal(notifications, '', scenario)
  }
})

test('given an infrastructure failure, the job fails naming it instead of starting a repair', (t) => {
  const cases = {
    'self-tests': /fork-sync self-tests failed/,
    'step:pnpm install:release': /pnpm install:release failed/,
    'step:mobile pnpm install': /mobile pnpm install failed/,
    select: /could not select the unit tests to run/,
    upstream: /could not produce the upstream v1\.1\.0 test report/,
    'no-fork-report': /the fork test run produced no report/
  }
  for (const [scenario, message] of Object.entries(cases)) {
    const { run, notifications } = verifyWith(t, `'${scenario}'`)
    assert.equal(run.status, 1, scenario)
    assert.equal(run.stdout, '', `${scenario}: verify must not return`)
    assert.match(notifications, message, scenario)
  }
})

// A release with a mobile/ app in a git repo whose upstream worktree setup is real;
// run_step records each step's name and directory instead of running it.
function baselineRepo(t) {
  const dir = tempDir(t)
  const repo = join(dir, 'state/repo')
  mkdirSync(join(repo, 'mobile'), { recursive: true })
  mkdirSync(join(dir, 'scratch/sync'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  commit(
    repo,
    { 'pnpm-lock.yaml': 'lockfileVersion: 9\n', 'mobile/package.json': '{}\n' },
    'release'
  )
  git(repo, 'update-ref', 'refs/upstream-tags/v1.1.0', 'HEAD')
  return { dir, repo }
}

function runUpstream(dir, repo, failingStep, call) {
  const run = runFunctions(
    dir,
    ['log', 'test_scope_key', 'upstream_baseline_key', 'upstream_report'],
    [
      `latest=v1.1.0 latest_ref=refs/upstream-tags/v1.1.0 COMPARE='${COMPARE}' VITEST_WORKERS=`,
      `UPSTREAM_WORKTREE='${dir}/state/test-run/upstream' UPSTREAM_ROOT='${dir}/state/test-run/upstream'`,
      'step_limits() { echo "60 60"; }',
      `run_step() { echo "$1|$(pwd)" >> '${dir}/steps'; [[ "$1" != '${failingStep}' ]]; }`,
      `run_scoped_tests() { echo tests >> '${dir}/steps'; echo '{"testResults":[]}' > "$2"; echo ok > "\${2%.json}.log"; }`,
      `cd '${repo}'`,
      call
    ].join('\n')
  )
  return { run, steps: readOr(join(dir, 'steps')) }
}

const REPORT =
  'if upstream_report; then echo "upstream_report returned 0"; else echo "upstream_report returned $?"; fi'

function upstreamWith(t, failingStep) {
  const { dir, repo } = baselineRepo(t)
  return { dir, ...runUpstream(dir, repo, failingStep, REPORT) }
}

test('given the upstream baseline is built, both the root and the mobile dependencies are installed first', (t) => {
  const { dir, run, steps } = upstreamWith(t, 'none')
  assert.equal(run.stdout.trim(), 'upstream_report returned 0', run.stderr)
  const worktree = join(dir, 'state/test-run/upstream')
  assert.equal(
    steps,
    `upstream pnpm install|${worktree}\nupstream mobile pnpm install|${worktree}\ntests\n`
  )
})

test('given an upstream install fails, no tests run and the baseline is reported missing', (t) => {
  for (const [step, message] of [
    ['upstream pnpm install', /Upstream pnpm install failed/],
    ['upstream mobile pnpm install', /Upstream mobile pnpm install failed/]
  ]) {
    const { run, steps } = upstreamWith(t, step)
    assert.equal(run.stdout.trim(), 'upstream_report returned 1', `${step}: ${run.stderr}`)
    assert.doesNotMatch(steps, /tests/, step)
    assert.match(run.stderr, message, step)
  }
})

function cacheBaseline(dir, key) {
  for (const kind of ['tests', 'confirm']) {
    writeFileSync(join(dir, `state/upstream-${kind}-${key}.json`), '{"testResults":[]}\n')
    writeFileSync(join(dir, `state/upstream-${kind}-${key}.log`), 'cached\n')
  }
}

// The key exactly as upstream_baseline_key computed it before baselines
// included mobile/'s install.
function keyBeforeFormatRevision(dir, repo) {
  const out = (cmd, ...args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
  const fields = [
    'v1.1.0',
    git(repo, 'rev-parse', 'refs/upstream-tags/v1.1.0^{commit}'),
    git(repo, 'rev-parse', 'refs/upstream-tags/v1.1.0:pnpm-lock.yaml'),
    out('node', '--version'),
    out('sw_vers', '-productVersion'),
    out('uname', '-m'),
    `${dir}/state/test-run/upstream`,
    'workers=default',
    'tests=full'
  ]
  return createHash('sha256').update(fields.join('|')).digest('hex').slice(0, 16)
}

test('given a baseline cached under the current key, it is reused without rebuilding', (t) => {
  const { dir, repo } = baselineRepo(t)
  const { run: keyRun } = runUpstream(dir, repo, 'none', 'upstream_baseline_key')
  assert.equal(keyRun.status, 0, keyRun.stderr)
  cacheBaseline(dir, keyRun.stdout.trim())
  const { run, steps } = runUpstream(dir, repo, 'none', REPORT)
  assert.equal(run.stdout.trim(), 'upstream_report returned 0', run.stderr)
  assert.match(run.stderr, /Reusing upstream v1\.1\.0 test baseline/)
  assert.equal(steps, '')
})

test('given a baseline cached before mobile installs were part of it, it is rebuilt', (t) => {
  const { dir, repo } = baselineRepo(t)
  cacheBaseline(dir, keyBeforeFormatRevision(dir, repo))
  const { run, steps } = runUpstream(dir, repo, 'none', REPORT)
  assert.equal(run.stdout.trim(), 'upstream_report returned 0', run.stderr)
  assert.doesNotMatch(run.stderr, /Reusing upstream/)
  assert.match(steps, /upstream mobile pnpm install/)
})
