import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { git } from './git-fixtures.mjs'
import { harnessScript, runFunctions, tempDir } from './shell-harness.mjs'

const WATCHDOG = [
  'log',
  'fail',
  'cpu_count',
  'descendant_pids',
  'kill_step_tree',
  'stop_current_step',
  'run_step'
]
const QUICK_WATCH = 'WATCHDOG_POLL_SECONDS=0.2 KILL_GRACE_SECONDS=0.5 CURRENT_STEP_PID='
const LOAD = (load, cores = 8) =>
  `load_average_5m() { echo ${load}; }; cpu_count() { echo ${cores}; }`

// Why: the machine may be heavily loaded, so tests assert which limit tripped
// and what survived, never how fast; this outer limit only turns a watchdog
// that never trips into a failure instead of a hang.
const OUTER_TIMEOUT_MS = 5 * 60 * 1000
const FAR = 600

// Runs `body` as a watched step named "unit tests (fork)".
function watchStep(t, body, { budget = FAR, stall = 1 } = {}) {
  const dir = tempDir(t)
  const run = runFunctions(
    dir,
    WATCHDOG,
    [
      LOAD('3.25'),
      QUICK_WATCH,
      `D='${dir}'`,
      `step() { ${body}; }`,
      `run_step 'unit tests (fork)' ${budget} ${stall} '${dir}/step.log' step`
    ].join('\n'),
    { timeout: OUTER_TIMEOUT_MS }
  )
  assert.equal(run.error, undefined, 'the watched step finished before the outer timeout')
  const notifications = existsSync(join(dir, 'notifications'))
    ? readFileSync(join(dir, 'notifications'), 'utf8')
    : ''
  return { dir, run, notifications }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false
    }
    throw error
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function eventuallyDead(pids) {
  for (let attempt = 0; attempt < 600 && pids.some(alive); attempt += 1) {
    await pause(100)
  }
  return pids.filter(alive)
}

const readPid = (path) => Number(readFileSync(path, 'utf8'))

test('given a step that stops producing output, the watchdog kills it and fails with the machine load', async (t) => {
  const { dir, run, notifications } = watchStep(
    t,
    `echo started; sleep ${FAR} & echo $! > "$D/sleep.pid"; wait`
  )
  assert.equal(run.status, 1)
  assert.match(notifications, /unit tests \(fork\) stalled .*machine load was 3\.25 on 8 cores/)
  assert.deepEqual(await eventuallyDead([readPid(join(dir, 'sleep.pid'))]), [])
})

test('given a step that keeps printing past its budget, the watchdog kills it and fails', (t) => {
  const { run, notifications } = watchStep(t, 'while true; do echo tick; sleep 0.1; done', {
    budget: 2,
    stall: FAR
  })
  assert.equal(run.status, 1)
  assert.match(notifications, /unit tests \(fork\) exceeded its budget of 2s/)
})

test('given a step that keeps printing, it runs to completion past the stall threshold', (t) => {
  const stall = 4
  const { dir, run, notifications } = watchStep(
    t,
    'date +%s; for i in $(seq 1 40); do echo "line $i"; sleep 0.2; done; date +%s',
    { stall }
  )
  assert.equal(run.status, 0, run.stderr)
  assert.equal(notifications, '')
  const log = readFileSync(join(dir, 'step.log'), 'utf8').trim().split('\n')
  assert.equal(log.at(-2), 'line 40')
  const ranFor = Number(log.at(-1)) - Number(log[0])
  assert.ok(ranFor > stall, `the step outlived the ${stall}s stall threshold (ran ${ranFor}s)`)
})

test('given a step that fails on its own, its exit status is returned without a watchdog trip', (t) => {
  const { run, notifications } = watchStep(t, 'echo boom; return 3', {})
  assert.equal(run.status, 3)
  assert.equal(notifications, '')
})

test('given a stalled step with a child, a grandchild and a detached process, none survive the kill', async (t) => {
  const { dir, run } = watchStep(
    t,
    [
      `sh -c 'sleep ${FAR} & echo $! > "$0/grandchild.pid"; wait' "$D" &`,
      'echo $! > "$D/child.pid"',
      `node -e 'const c = require("child_process").spawn("sleep", ["${FAR}"], { detached: true, stdio: "ignore" }); require("fs").writeFileSync(process.argv[1], String(c.pid)); c.unref(); setInterval(() => {}, 1e6)' "$D/detached.pid" &`,
      // Keep printing until every process exists, so a slow start cannot look like a stall.
      'until [ -s "$D/detached.pid" ] && [ -s "$D/grandchild.pid" ]; do echo starting; sleep 0.1; done',
      'echo ready',
      'wait'
    ].join('\n')
  )
  assert.equal(run.status, 1)
  const pids = ['child', 'grandchild', 'detached'].map((name) => readPid(join(dir, `${name}.pid`)))
  assert.deepEqual(await eventuallyDead(pids), [])
})

test('given the job is terminated during a step, the step tree is killed on exit', async (t) => {
  const dir = tempDir(t)
  const job = spawn(
    '/bin/bash',
    [
      '-c',
      harnessScript(
        dir,
        WATCHDOG,
        [
          LOAD('1.0'),
          QUICK_WATCH,
          `trap stop_current_step EXIT`,
          `trap 'exit 143' TERM`,
          `step() { sleep ${FAR} & echo $! > '${dir}/child.pid'; wait; }`,
          `run_step 'typecheck' ${FAR} ${FAR} '${dir}/step.log' step`
        ].join('\n')
      )
    ],
    { stdio: 'ignore' }
  )
  for (let attempt = 0; attempt < 600 && !existsSync(join(dir, 'child.pid')); attempt += 1) {
    await pause(100)
  }
  const child = readPid(join(dir, 'child.pid'))
  const exited = new Promise((resolve) => job.on('exit', (code) => resolve(code)))
  job.kill('SIGTERM')
  assert.equal(await exited, 143)
  assert.deepEqual(await eventuallyDead([child]), [])
})

const workersAt = (t, load, cores) => {
  const run = runFunctions(
    tempDir(t),
    ['vitest_workers'],
    `${LOAD(load, cores)}; echo "[$(vitest_workers)]"`
  )
  assert.equal(run.status, 0, run.stderr)
  return run.stdout.trim()
}

test('given the load at or below the core count, vitest keeps its default worker count', (t) => {
  assert.equal(workersAt(t, '2.50', 8), '[]')
  assert.equal(workersAt(t, '8.00', 8), '[]')
})

test('given the load above the core count, vitest workers shrink with the excess load', (t) => {
  assert.equal(workersAt(t, '9.50', 8), '[4]')
  assert.equal(workersAt(t, '13.00', 8), '[3]')
  assert.equal(workersAt(t, '30.00', 8), '[1]')
  assert.equal(workersAt(t, '11.20', 10), '[5]')
  assert.equal(workersAt(t, '3.00', 1), '[1]')
})

test('given workers were chosen once, later vitest runs in the same sync reuse that count', (t) => {
  const run = runFunctions(
    tempDir(t),
    ['log', 'vitest_workers', 'choose_vitest_workers'],
    [
      'VITEST_WORKERS= VITEST_WORKERS_CHOSEN=false',
      LOAD('13.00', 8),
      'choose_vitest_workers',
      LOAD('1.00', 8),
      'choose_vitest_workers',
      'echo "[$VITEST_WORKERS]"'
    ].join('\n')
  )
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), '[3]')
  assert.equal(run.stderr.match(/Vitest workers for this sync: 3 /g).length, 1)
})

function vitestArgs(t, workers) {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'bin'))
  for (const tool of ['node', 'pnpm']) {
    writeFileSync(join(dir, 'bin', tool), `#!/bin/sh\necho "${tool} $*" >> '${dir}/calls'\n`, {
      mode: 0o755
    })
  }
  const run = runFunctions(
    dir,
    ['unit_test_commands'],
    `PATH='${dir}/bin':"$PATH" VITEST_WORKERS='${workers}'; unit_test_commands '${dir}/r.json' src/a.test.ts`
  )
  assert.equal(run.status, 0, run.stderr)
  return readFileSync(join(dir, 'calls'), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('pnpm'))
}

test('given a chosen worker count, vitest runs with it; otherwise with its default', (t) => {
  assert.match(vitestArgs(t, '3'), / --maxWorkers=3 src\/a\.test\.ts$/)
  assert.doesNotMatch(vitestArgs(t, ''), /maxWorkers/)
})

const busyGuard = (t, load) => {
  const dir = tempDir(t)
  const run = runFunctions(
    dir,
    ['log', 'exit_if_machine_busy'],
    `${LOAD(load, 8)}; exit_if_machine_busy; echo continued`
  )
  const notifications = existsSync(join(dir, 'notifications'))
    ? readFileSync(join(dir, 'notifications'), 'utf8')
    : ''
  return { run, notifications }
}

test('given a load above twice the core count at startup, the sync is skipped cleanly', (t) => {
  const { run, notifications } = busyGuard(t, '16.01')
  assert.equal(run.status, 0)
  assert.equal(run.stdout, '')
  assert.match(run.stderr, /SKIPPED: machine busy \(5-minute load 16\.01 on 8 cores\)/)
  assert.match(notifications, /machine busy, sync skipped/)
})

test('given a load up to twice the core count at startup, the sync proceeds', (t) => {
  for (const load of ['16.00', '3.00']) {
    const { run, notifications } = busyGuard(t, load)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout.trim(), 'continued')
    assert.equal(notifications, '')
  }
})

test('given the real system, the load average and core count read as numbers', (t) => {
  const run = runFunctions(
    tempDir(t),
    ['load_average_5m', 'cpu_count'],
    'echo "$(load_average_5m) $(cpu_count)"'
  )
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout.trim(), /^\d+(\.\d+)? \d+$/)
})

test('given a non-numeric watchdog setting, the job fails with the setting name', (t) => {
  const dir = tempDir(t)
  const run = runFunctions(
    dir,
    ['log', 'fail', 'minutes_setting'],
    'ORCA_SYNC_STALL_MINUTES=soon; minutes_setting ORCA_SYNC_STALL_MINUTES 30'
  )
  assert.equal(run.status, 1)
  assert.match(readFileSync(join(dir, 'notifications'), 'utf8'), /ORCA_SYNC_STALL_MINUTES/)
})

test('given watchdog settings in minutes, they convert to seconds with defaults', (t) => {
  const run = runFunctions(
    tempDir(t),
    ['log', 'fail', 'minutes_setting'],
    'ORCA_SYNC_BUILD_BUDGET_MINUTES=90; echo "$(minutes_setting ORCA_SYNC_BUILD_BUDGET_MINUTES 60) $(minutes_setting ORCA_SYNC_UNSET_MINUTES 45)"'
  )
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), '5400 2700')
})

test('given a different vitest worker count, the upstream baseline key changes', (t) => {
  const dir = tempDir(t)
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  git(repo, 'add', 'pnpm-lock.yaml')
  git(repo, 'commit', '-q', '-m', 'release')
  git(repo, 'update-ref', 'refs/upstream-tags/v1.0.0', 'HEAD')
  const key = (workers) => {
    const run = runFunctions(
      dir,
      ['upstream_baseline_key'],
      `latest=v1.0.0 latest_ref=refs/upstream-tags/v1.0.0 UPSTREAM_ROOT='${dir}/upstream' VITEST_WORKERS='${workers}'; cd '${repo}'; upstream_baseline_key`
    )
    assert.equal(run.status, 0, run.stderr)
    return run.stdout.trim()
  }
  assert.equal(key('3'), key('3'))
  assert.notEqual(key('3'), key(''))
  assert.notEqual(key('3'), key('4'))
})

test('given a logged step, its output reaches the job log and its exit status is returned', (t) => {
  const dir = tempDir(t)
  const run = runFunctions(
    dir,
    [...WATCHDOG, 'run_logged_step'],
    [
      LOAD('1.0'),
      QUICK_WATCH,
      `mkdir -p '${dir}/scratch/sync'`,
      'step() { echo "typecheck output"; return 2; }',
      'run_logged_step \'typecheck\' 30 5 step || echo "status=$?"'
    ].join('\n')
  )
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), 'status=2')
  assert.match(run.stderr, /typecheck started; live output in .*step-typecheck\.log/)
  assert.match(run.stderr, /^typecheck output$/m)
})

const limits = (t, env, kinds) => {
  const dir = tempDir(t)
  const run = runFunctions(
    dir,
    ['log', 'fail', 'minutes_setting', 'load_watchdog_settings', 'step_limits'],
    [
      env,
      'load_watchdog_settings',
      ...kinds.map((kind) => `echo "${kind}: $(step_limits ${kind})"`)
    ].join('\n')
  )
  return { dir, run }
}

test('given default settings, silent typecheck, build and Claude steps get budgets without a stall limit', (t) => {
  const { run } = limits(t, ':', ['tests', 'install', 'typecheck', 'build', 'claude'])
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.stdout.trim().split('\n'), [
    'tests: 7200 1800',
    'install: 1800 1800',
    'typecheck: 5400 0',
    'build: 5400 0',
    'claude: 3600 0'
  ])
})

test('given overrides, budgets change and the stall limit applies only to streaming steps', (t) => {
  const { run } = limits(
    t,
    'ORCA_SYNC_STALL_MINUTES=5 ORCA_SYNC_TYPECHECK_BUDGET_MINUTES=100 ORCA_SYNC_BUILD_BUDGET_MINUTES=120',
    ['tests', 'install', 'typecheck', 'build']
  )
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.stdout.trim().split('\n'), [
    'tests: 7200 300',
    'install: 1800 300',
    'typecheck: 6000 0',
    'build: 7200 0'
  ])
})

test('given an unknown kind of step, the job fails instead of running it unwatched', (t) => {
  const { dir, run } = limits(t, ':', [])
  assert.equal(run.status, 0, run.stderr)
  const unknown = runFunctions(
    dir,
    ['log', 'fail', 'minutes_setting', 'load_watchdog_settings', 'step_limits'],
    'load_watchdog_settings; step_limits deploy'
  )
  assert.equal(unknown.status, 1)
  assert.match(readFileSync(join(dir, 'notifications'), 'utf8'), /unknown kind of step 'deploy'/)
})
