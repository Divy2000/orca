import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'

const HERE = import.meta.dirname

test('given the other fork-sync test files run, they leave nothing in the temp directory', (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'fork-sync-leak-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const files = readdirSync(HERE)
    .filter((file) => file.endsWith('.test.mjs') && file !== basename(import.meta.filename))
    .map((file) => join(HERE, file))
  // Why: an inherited NODE_TEST_CONTEXT makes the nested runner report silently to a parent that is not listening.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    encoding: 'utf8',
    env: { ...env, TMPDIR: temp }
  })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.match(run.stdout, /^# pass [1-9]\d*$/m, 'the nested run executed tests')
  assert.deepEqual(readdirSync(temp), [])
})
