import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runFunctions, tempDir } from './shell-harness.mjs'

const GB_KB = 1024 * 1024
const CHOOSE = ['log', 'choose_test_run_dir']

const choose = (t, freeKb) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'state'), { recursive: true })
  mkdirSync(join(dir, 'scratch/sync'), { recursive: true })
  const run = runFunctions(
    dir,
    CHOOSE,
    [
      `MIN_INTERNAL_TEST_FREE_KB=${6 * GB_KB}`,
      `free_kb() { [[ "$1" == '${dir}/state' ]] && echo ${freeKb}; }`,
      'choose_test_run_dir',
      'echo "$TEST_RUN_DIR|$UPSTREAM_WORKTREE|$UPSTREAM_ROOT"'
    ].join('\n')
  )
  assert.equal(run.status, 0, run.stderr)
  return { dir, run, chosen: run.stdout.trim().split('|') }
}

test('given at least 6 GB free on the internal disk, test runs use the internal state dir', (t) => {
  const { dir, chosen } = choose(t, 6 * GB_KB)
  assert.deepEqual(chosen, [
    `${dir}/state/test-run`,
    `${dir}/state/test-run/upstream`,
    `${realpathSync(join(dir, 'state/test-run'))}/upstream`
  ])
  assert.ok(existsSync(join(dir, 'state/test-run/tmp')))
})

test('given less than 6 GB free on the internal disk, test runs fall back to scratch and say so', (t) => {
  const { dir, run, chosen } = choose(t, 6 * GB_KB - 1)
  assert.deepEqual(chosen.slice(0, 2), [
    `${dir}/scratch/sync/test-run`,
    `${dir}/scratch/sync/test-run/upstream`
  ])
  assert.ok(existsSync(join(dir, 'scratch/sync/test-run/tmp')))
  assert.equal(existsSync(join(dir, 'state/test-run')), false)
  assert.match(
    run.stderr,
    /Internal disk has only 5 GB free; running tests from .*scratch\/sync\/test-run/
  )
})

test('given the real system, free space on the state disk reads as a number of KB', (t) => {
  const dir = tempDir(t)
  const run = runFunctions(dir, ['free_kb'], `free_kb '${dir}'`)
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout.trim(), /^\d+$/)
})

test('given test-run data on both disks, run data cleanup removes both and keeps other state', (t) => {
  const dir = tempDir(t)
  for (const path of [
    'state/test-run/upstream/node_modules',
    'state/test-run/tmp/vitest',
    'scratch/sync/test-run/upstream',
    'scratch/sync/upstream',
    'scratch/sync/staged/Orca.app'
  ]) {
    mkdirSync(join(dir, path), { recursive: true })
  }
  writeFileSync(join(dir, 'state/installed-commit'), 'abc\n')
  const run = runFunctions(dir, ['cleanup_run_data'], 'cleanup_run_data')
  assert.equal(run.status, 0, run.stderr)
  for (const gone of ['state/test-run', 'scratch/sync/test-run', 'scratch/sync/upstream']) {
    assert.equal(existsSync(join(dir, gone)), false, gone)
  }
  assert.equal(readFileSync(join(dir, 'state/installed-commit'), 'utf8'), 'abc\n')
  assert.ok(existsSync(join(dir, 'scratch/sync/staged/Orca.app')))
})

test('given a vitest run, it and its native runtime check use the test-run temp dir', (t) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'bin'))
  for (const tool of ['node', 'pnpm']) {
    writeFileSync(
      join(dir, 'bin', tool),
      `#!/bin/sh\necho "${tool} TMPDIR=$TMPDIR" >> '${dir}/calls'\n`,
      {
        mode: 0o755
      }
    )
  }
  const run = runFunctions(
    dir,
    ['unit_test_commands'],
    [
      `PATH='${dir}/bin':"$PATH" TMPDIR='${dir}/scratch-tmp' VITEST_WORKERS=`,
      `TEST_RUN_DIR='${dir}/state/test-run'`,
      `unit_test_commands '${dir}/r.json'`,
      'echo "after: $TMPDIR"'
    ].join('\n')
  )
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n'), [
    `node TMPDIR=${dir}/state/test-run/tmp`,
    `pnpm TMPDIR=${dir}/state/test-run/tmp`
  ])
  assert.equal(run.stdout.trim(), `after: ${dir}/scratch-tmp`)
})

test('given the run starts, vitest workers are fixed from the starting load before anything else adds load', (t) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'state'), { recursive: true })
  const run = runFunctions(
    dir,
    [
      'log',
      'cleanup_run_data',
      'exit_if_machine_busy',
      'vitest_workers',
      'choose_vitest_workers',
      'choose_test_run_dir',
      'prepare_run'
    ],
    [
      'VITEST_WORKERS= VITEST_WORKERS_CHOSEN=false',
      `MIN_INTERNAL_TEST_FREE_KB=${6 * GB_KB}`,
      `free_kb() { echo ${8 * GB_KB}; }`,
      'load_average_5m() { echo 13.00; }; cpu_count() { echo 8; }',
      'prepare_run',
      'load_average_5m() { echo 1.00; }',
      'choose_vitest_workers',
      'echo "workers=$VITEST_WORKERS tests=$TEST_RUN_DIR tmp=$TMPDIR"'
    ].join('\n')
  )
  assert.equal(run.status, 0, run.stderr)
  assert.equal(
    run.stdout.trim(),
    `workers=3 tests=${dir}/state/test-run tmp=${dir}/scratch/sync/tmp`
  )
  assert.match(run.stderr, /Vitest workers for this sync: 3 \(5-minute load 13\.00 on 8 cores\)/)
})
