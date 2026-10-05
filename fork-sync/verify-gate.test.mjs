import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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
function upstreamWith(t, failingStep) {
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
      'if upstream_report; then echo "upstream_report returned 0"; else echo "upstream_report returned $?"; fi'
    ].join('\n')
  )
  return { dir, run, steps: readOr(join(dir, 'steps')) }
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
