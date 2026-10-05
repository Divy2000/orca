import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  confirmedFailures,
  failingTestIds,
  filesToRerun,
  newFailures,
  reportFailureIds,
  unhandledErrorIds
} from './compare-test-failures.mjs'

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

test('given the CLI path contains spaces, the CLI still runs and reports introduced failures', async (t) => {
  const { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const root = mkdtempSync(join(tmpdir(), 'cmp-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'Application Support')
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

test('given two upstream reports, only failures present in both count as upstream failures', () => {
  const first = failingTestIds(
    report('/up', [
      [
        'a.test.ts',
        'failed',
        [
          ['flaky', 'failed'],
          ['stable', 'failed']
        ]
      ]
    ]),
    '/up'
  )
  const second = failingTestIds(
    report('/up', [['a.test.ts', 'failed', [['stable', 'failed']]]]),
    '/up'
  )
  const fork = failingTestIds(
    report('/fork', [
      [
        'a.test.ts',
        'failed',
        [
          ['flaky', 'failed'],
          ['stable', 'failed']
        ]
      ]
    ]),
    '/fork'
  )
  assert.deepEqual(newFailures(confirmedFailures([first, second]), fork), ['a.test.ts > flaky'])
})

const UNHANDLED_LOG = `⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
Vitest caught 2 unhandled errors during the test run.
This error originated in "src/a.test.ts" test file. It doesn't mean the error was thrown inside the file itself, but while it was running.
⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯
Error: no origin
`

test('given a console log, unhandled errors become per-file ids and unattributed ones are counted', () => {
  assert.deepEqual([...unhandledErrorIds(UNHANDLED_LOG)].sort(), [
    '(unhandled error without a test file) #1',
    'src/a.test.ts > (unhandled error) #1'
  ])
})

test('given a log with no unhandled errors, there are no unhandled ids', () => {
  assert.deepEqual([...unhandledErrorIds(' Test Files  1 passed (1)\n')], [])
})

test('given a report with a sibling console log, its unhandled errors are failures', async (t) => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'cmp-log-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'fork.json'), JSON.stringify(report('/fork', [])))
  writeFileSync(join(dir, 'fork.log'), UNHANDLED_LOG)
  assert.ok(
    reportFailureIds(join(dir, 'fork.json'), '/fork').has('src/a.test.ts > (unhandled error) #1')
  )
})

test('given failure ids, the list of files to re-run excludes unattributed errors', () => {
  assert.deepEqual(
    filesToRerun(
      new Set([
        'b.test.ts > z',
        'src/a.test.ts > (unhandled error) #1',
        '(unhandled error without a test file) #1'
      ])
    ),
    ['b.test.ts', 'src/a.test.ts']
  )
})

test('given repeated unhandled errors from one file, each occurrence is its own id', () => {
  const log = `⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
Vitest caught 2 unhandled errors during the test run.
This error originated in "src/a.test.ts" test file. x
This error originated in "src/a.test.ts" test file. y
 Test Files  1 passed (1)
`
  assert.deepEqual([...unhandledErrorIds(log)].sort(), [
    'src/a.test.ts > (unhandled error) #1',
    'src/a.test.ts > (unhandled error) #2'
  ])
})

test('given test output that imitates the attribution line, it is not treated as attribution', () => {
  const log = `stdout | src/b.test.ts > prints
This error originated in "src/a.test.ts" test file.
⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
Vitest caught 1 unhandled error during the test run.
Error: something   This error originated in "src/a.test.ts" test file.
 Test Files  1 passed (1)
`
  assert.deepEqual([...unhandledErrorIds(log)], ['(unhandled error without a test file) #1'])
})

test('given colored reporter output, unhandled errors are still found', () => {
  const log = `\u001b[31m⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯\u001b[39m
\u001b[31mVitest caught 1 unhandled error during the test run.\u001b[39m
\u001b[2mThis error originated in "\u001b[36msrc/a.test.ts\u001b[2m" test file.\u001b[22m
 Test Files  1 passed (1)
`
  assert.deepEqual([...unhandledErrorIds(log)], ['src/a.test.ts > (unhandled error) #1'])
})

test('given a fake banner printed by a test before the real one, the real final block is used', () => {
  const log = `⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
Vitest caught 0 unhandled errors during the test run.
 Test Files  1 passed (1)
⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
Vitest caught 1 unhandled error during the test run.
This error originated in "src/a.test.ts" test file.
 Test Files  1 passed (1)
`
  assert.deepEqual([...unhandledErrorIds(log)], ['src/a.test.ts > (unhandled error) #1'])
})

test('given a stray banner after the real block, the real block is still used', () => {
  const log = `⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
Vitest caught 1 unhandled error during the test run.
This error originated in "src/a.test.ts" test file.
 Test Files  1 passed (1)
⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
`
  assert.deepEqual([...unhandledErrorIds(log)], ['src/a.test.ts > (unhandled error) #1'])
})
