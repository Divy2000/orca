import assert from 'node:assert/strict'
import { test } from 'node:test'
import { failingTestIds, newFailures } from './compare-test-failures.mjs'

const report = (root, files) => ({
  testResults: files.map(([file, status, assertions]) => ({
    name: `${root}/${file}`,
    status,
    assertionResults: assertions.map(([fullName, s]) => ({ fullName, status: s }))
  }))
})

test('given failed assertions, ids are root-relative file plus full test name', () => {
  const ids = failingTestIds(
    report('/up', [
      [
        'a.test.ts',
        'failed',
        [
          ['x works', 'failed'],
          ['y', 'passed']
        ]
      ]
    ]),
    '/up'
  )
  assert.deepEqual([...ids], ['a.test.ts > x works'])
})

test('given a file that failed to load, the file itself counts as one failure', () => {
  const ids = failingTestIds(report('/up', [['broken.test.ts', 'failed', []]]), '/up')
  assert.deepEqual([...ids], ['broken.test.ts > (file failed)'])
})

test('given different checkout roots, the same failure matches across runs', () => {
  const up = failingTestIds(report('/up', [['a.test.ts', 'failed', [['x', 'failed']]]]), '/up')
  const fork = failingTestIds(
    report('/fork', [['a.test.ts', 'failed', [['x', 'failed']]]]),
    '/fork'
  )
  assert.deepEqual(newFailures(up, fork), [])
})

test('given a failure only in the fork, it is reported as introduced', () => {
  const up = failingTestIds(report('/up', [['a.test.ts', 'failed', [['x', 'failed']]]]), '/up')
  const fork = failingTestIds(
    report('/fork', [
      ['a.test.ts', 'failed', [['x', 'failed']]],
      ['b.test.ts', 'failed', [['z', 'failed']]]
    ]),
    '/fork'
  )
  assert.deepEqual(newFailures(up, fork), ['b.test.ts > z'])
})

test('given a failure fixed in the fork, nothing is reported', () => {
  const up = failingTestIds(report('/up', [['a.test.ts', 'failed', [['x', 'failed']]]]), '/up')
  assert.deepEqual(newFailures(up, new Set()), [])
})

test('given a fork-only file error next to a known assertion failure, the file error is reported', () => {
  const up = failingTestIds(report('/up', [['a.test.ts', 'failed', [['x', 'failed']]]]), '/up')
  const forkReport = report('/fork', [['a.test.ts', 'failed', [['x', 'failed']]]])
  forkReport.testResults[0].message = 'afterAll hook failed'
  assert.deepEqual(newFailures(up, failingTestIds(forkReport, '/fork')), [
    'a.test.ts > (file failed)'
  ])
})

test('given a requested file missing from a retry report, it still counts as failing', () => {
  const retry = report('/fork', [])
  assert.deepEqual(
    [...failingTestIds(retry, '/fork', ['b.test.ts'])],
    ['b.test.ts > (file missing from report)']
  )
})

test('given the CLI path contains spaces, the CLI still runs and reports introduced failures', async () => {
  const { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const dir = join(mkdtempSync(join(tmpdir(), 'cmp-')), 'Application Support')
  mkdirSync(dir)
  const cli = join(dir, 'compare-test-failures.mjs')
  copyFileSync(new URL('./compare-test-failures.mjs', import.meta.url), cli)
  writeFileSync(join(dir, 'up.json'), JSON.stringify(report('/up', [])))
  writeFileSync(
    join(dir, 'fork.json'),
    JSON.stringify(report('/fork', [['b.test.ts', 'failed', [['z', 'failed']]]]))
  )
  const run = spawnSync(
    process.execPath,
    [cli, join(dir, 'up.json'), '/up', join(dir, 'fork.json'), '/fork'],
    { encoding: 'utf8' }
  )
  assert.equal(run.status, 1)
  assert.equal(run.stdout.trim(), 'b.test.ts > z')
})
