import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { commit, git } from './git-fixtures.mjs'
import { runFunctions, tempDir } from './shell-harness.mjs'

const RELEASE = 'refs/upstream-tags/v1.1.0'

const FORK_CHANGES = {
  'src/a.ts': 'export const a = 2\n',
  'src/fork-only.ts': 'export const forkOnly = 1\n',
  'src/old.ts': null,
  'src/renamed.ts': 'export const old = 1\n',
  'src/gone.ts': null,
  'test/new.test.ts': 'test("new", () => {})\n',
  'README.md': 'fork readme\n',
  'fork-sync/tool.mjs': 'export {}\n'
}

// Edits and additions only, with docs and fork-sync/ noise.
const RELATED_CHANGES = {
  'src/a.ts': 'export const a = 2\n',
  'src/fork-only.ts': 'export const forkOnly = 1\n',
  'test/new.test.ts': 'test("new", () => {})\n',
  'README.md': 'fork readme\n',
  'fork-sync/tool.mjs': 'export {}\n'
}

// Vitest configs that reach helpers the way config/vitest.config.ts does: by
// relative import (with and without an extension) and as setupFiles paths.
const VITEST_CONFIGS = {
  'config/vitest.config.ts': [
    "import { resolve } from 'node:path'",
    "import { UNIT_INCLUDE } from './scripts/ci-unit-files.mjs'",
    'export default {',
    '  test: {',
    '    include: UNIT_INCLUDE,',
    '    setupFiles: [resolve(\'config/scripts/vitest-guard.ts\'), resolve("config/scripts/happy-dom-setup.ts")]',
    '  }',
    '}',
    ''
  ].join('\n'),
  'config/vitest.performance.config.ts': [
    "import baseConfig from './vitest.config'",
    "import { perf } from './scripts/perf.helper'",
    'export default { ...baseConfig, perf }',
    ''
  ].join('\n'),
  'config/scripts/ci-unit-files.mjs': 'export const UNIT_INCLUDE = []\n',
  'config/scripts/vitest-guard.ts': 'export {}\n',
  'config/scripts/happy-dom-setup.ts': 'export {}\n',
  'config/scripts/perf.helper.ts': 'export const perf = 1\n',
  'config/scripts/unrelated.mjs': 'export {}\n'
}

// The release has src/a.ts, src/old.ts, src/gone.ts, docs, fork-sync/ files and
// vitest configs; by default the fork edits, adds, renames and deletes sources.
function forkRepo(t, changes = FORK_CHANGES) {
  const dir = tempDir(t)
  const repo = join(dir, 'repo')
  for (const path of ['src', 'test', 'docs', 'fork-sync', 'config/scripts']) {
    mkdirSync(join(repo, path), { recursive: true })
  }
  git(repo, 'init', '-q', '-b', 'main')
  commit(
    repo,
    {
      'src/a.ts': 'export const a = 1\n',
      'src/old.ts': 'export const old = 1\n',
      'src/gone.ts': 'export const gone = 1\n',
      'README.md': 'readme\n',
      'docs/old.md': 'old\n',
      'fork-sync/old.mjs': 'export {}\n',
      ...VITEST_CONFIGS
    },
    'release'
  )
  git(repo, 'update-ref', RELEASE, 'HEAD')
  for (const path of Object.keys(changes)) {
    mkdirSync(join(repo, path, '..'), { recursive: true })
  }
  commit(repo, changes, 'fork changes')
  return { dir, repo }
}

const RELATED_FUNCTIONS = [
  'log',
  'source_files',
  'fork_changed_sources',
  'paths_in_upstream',
  'count_lines'
]

test('given fork changes, the related list holds changed sources that exist in the fork, minus fork-sync and non-source files', (t) => {
  const { dir, repo } = forkRepo(t)
  const run = runFunctions(
    dir,
    RELATED_FUNCTIONS,
    `latest_ref=${RELEASE}; cd '${repo}'; fork_changed_sources`
  )
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.stdout.trim().split('\n'), [
    'src/a.ts',
    'src/fork-only.ts',
    'src/renamed.ts',
    'test/new.test.ts'
  ])
})

test('given the related list, the upstream run gets only the paths that exist in the release', (t) => {
  const { dir, repo } = forkRepo(t)
  const run = runFunctions(
    dir,
    RELATED_FUNCTIONS,
    `latest_ref=${RELEASE}; cd '${repo}'; fork_changed_sources | paths_in_upstream`
  )
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, 'src/a.ts\n')
})

const selectScope = (t, env, changes = RELATED_CHANGES) => {
  const { dir, repo } = forkRepo(t, changes)
  return runFunctions(
    dir,
    [...RELATED_FUNCTIONS, 'vitest_config_inputs', 'full_suite_reason', 'select_test_scope'],
    [
      `latest=v1.1.0 latest_ref=${RELEASE}`,
      env,
      `cd '${repo}'`,
      'select_test_scope',
      'printf "scope=%s\\nfork=%s\\nupstream=%s\\n" "$TEST_SCOPE" "$(echo $RELATED_FORK_SOURCES)" "$(echo $RELATED_UPSTREAM_SOURCES)"'
    ].join('\n')
  )
}

test('given only edits and additions, the gate selects related tests for both runs and logs the counts', (t) => {
  const run = selectScope(t, ':')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(
    run.stdout,
    'scope=related\nfork=src/a.ts src/fork-only.ts test/new.test.ts\nupstream=src/a.ts\n'
  )
  assert.match(
    run.stderr,
    /Related tests: 3 changed source file\(s\) selected for the fork run; 1 of them exist in v1\.1\.0\./
  )
})

test('given a deleted or renamed-away source file, the gate falls back to the full suites and says why', (t) => {
  const run = selectScope(t, ':', FORK_CHANGES)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, 'scope=full\nfork=\nupstream=\n')
  assert.match(
    run.stderr,
    /Running the full unit test suites: the fork deleted or renamed away 2 source file\(s\): src\/gone\.ts src\/old\.ts\./
  )
})

const GLOBAL_INPUTS = [
  'pnpm-lock.yaml',
  'package.json',
  'mobile/package.json',
  'mobile/pnpm-lock.yaml',
  'tsconfig.json',
  'config/tsconfig.cli.json',
  'vitest.config.ts',
  'config/vitest.performance.config.ts',
  '.npmrc',
  'pnpm-workspace.yaml'
]

test('given a changed global test input, the gate falls back to the full suites and says why', (t) => {
  for (const input of GLOBAL_INPUTS) {
    const run = selectScope(t, ':', { ...RELATED_CHANGES, [input]: 'changed\n' })
    assert.equal(run.status, 0, `${input}: ${run.stderr}`)
    assert.equal(run.stdout, 'scope=full\nfork=\nupstream=\n', input)
    assert.ok(
      run.stderr.includes(
        `Running the full unit test suites: the fork changed global test inputs: ${input}.`
      ),
      `${input}: ${run.stderr}`
    )
  }
})

test('given a fork change to a file the vitest configs load, the gate falls back to the full suites', (t) => {
  for (const input of [
    'config/scripts/vitest-guard.ts',
    'config/scripts/happy-dom-setup.ts',
    'config/scripts/ci-unit-files.mjs',
    'config/scripts/perf.helper.ts'
  ]) {
    const run = selectScope(t, ':', { ...RELATED_CHANGES, [input]: 'export const changed = 1\n' })
    assert.equal(run.status, 0, `${input}: ${run.stderr}`)
    assert.equal(run.stdout, 'scope=full\nfork=\nupstream=\n', input)
    assert.ok(
      run.stderr.includes(
        `Running the full unit test suites: the fork changed global test inputs: ${input}.`
      ),
      `${input}: ${run.stderr}`
    )
  }
})

test('given a fork change to a config/scripts file no vitest config loads, the gate still selects related tests', (t) => {
  const run = selectScope(t, ':', {
    ...RELATED_CHANGES,
    'config/scripts/unrelated.mjs': 'export const changed = 1\n'
  })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^scope=related\nfork=.*config\/scripts\/unrelated\.mjs/)
})

test('given fork-sync or non-source deletions and look-alike files, the gate still selects related tests', (t) => {
  const run = selectScope(t, ':', {
    ...RELATED_CHANGES,
    'fork-sync/old.mjs': null,
    'fork-sync/vitest.config.ts': 'changed\n',
    'docs/old.md': null,
    'src/package.json.ts': 'export {}\n',
    'src/lib/package.json': '{}\n'
  })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^scope=related\n/)
})

test('given ORCA_SYNC_FULL_TEST_SUITE=1, the gate runs the full suites', (t) => {
  const run = selectScope(t, 'ORCA_SYNC_FULL_TEST_SUITE=1')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, 'scope=full\nfork=\nupstream=\n')
  assert.match(run.stderr, /ORCA_SYNC_FULL_TEST_SUITE=1: running the full unit test suites\./)
})

test('given an empty related list, there is nothing to test and it is logged', (t) => {
  const dir = tempDir(t)
  const check = (state) =>
    runFunctions(
      dir,
      ['log', 'nothing_to_test'],
      `latest=v1.1.0 ${state}; if nothing_to_test; then echo skip; else echo run; fi`
    )
  const empty = check('TEST_SCOPE=related RELATED_FORK_SOURCES=')
  assert.equal(empty.stdout.trim(), 'skip')
  assert.match(
    empty.stderr,
    /No fork source changes relative to v1\.1\.0; no related unit tests to run\./
  )
  assert.equal(check("TEST_SCOPE=related RELATED_FORK_SOURCES='src/a.ts'").stdout.trim(), 'run')
  assert.equal(check('TEST_SCOPE=full RELATED_FORK_SOURCES=').stdout.trim(), 'run')
})

function scopedRun(t, state) {
  const dir = tempDir(t)
  const run = runFunctions(
    dir,
    ['log', 'count_lines', 'report_test_files', 'run_scoped_tests'],
    [
      state,
      `run_unit_tests() { printf '%s\\n' "$*" >> '${dir}/calls'; echo '{"testResults":[{"name":"x"},{"name":"y"}]}' > "$1"; }`,
      `run_scoped_tests 'fork tests' '${dir}/r.json' "$RELATED_FORK_SOURCES"`
    ].join('\n')
  )
  const calls = existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : ''
  return { dir, run, calls }
}

test('given related scope, vitest gets the related flag and the list of paths', (t) => {
  const { dir, run, calls } = scopedRun(
    t,
    "TEST_SCOPE=related RELATED_FORK_SOURCES=$'src/a.ts\\nsrc/fork-only.ts'"
  )
  assert.equal(run.status, 0, run.stderr)
  assert.equal(calls, `${dir}/r.json --related src/a.ts src/fork-only.ts\n`)
  assert.match(run.stderr, /fork tests: 2 test file\(s\) ran\./)
})

test('given related scope with no paths for this run, an empty report is written without running vitest', (t) => {
  const { dir, run, calls } = scopedRun(t, 'TEST_SCOPE=related RELATED_FORK_SOURCES=')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(calls, '')
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8')), { testResults: [] })
  assert.match(readFileSync(join(dir, 'r.log'), 'utf8'), /no related source files/)
  assert.match(run.stderr, /fork tests: no related source files; no tests run\./)
})

test('given full scope, vitest runs without the related flag', (t) => {
  const { dir, run, calls } = scopedRun(t, 'TEST_SCOPE=full RELATED_FORK_SOURCES=')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(calls, `${dir}/r.json\n`)
})

function vitestCall(t, args) {
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
    `PATH='${dir}/bin':"$PATH" VITEST_WORKERS=3; unit_test_commands '${dir}/r.json' ${args}`
  )
  assert.equal(run.status, 0, run.stderr)
  return readFileSync(join(dir, 'calls'), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('pnpm'))
    .replace(`${dir}/`, '')
}

test('given the related flag, vitest runs in related mode with the same config and workers', (t) => {
  assert.equal(
    vitestCall(t, '--related src/a.ts src/b.ts'),
    'pnpm exec vitest related --run --config config/vitest.config.ts --reporter=json --reporter=default --outputFile.json=r.json --maxWorkers=3 src/a.ts src/b.ts'
  )
  assert.equal(
    vitestCall(t, 'test/x.test.ts'),
    'pnpm exec vitest run --config config/vitest.config.ts --reporter=json --reporter=default --outputFile.json=r.json --maxWorkers=3 test/x.test.ts'
  )
})

test('given a different related list or the full suite, the upstream baseline key changes', (t) => {
  const { dir, repo } = forkRepo(t)
  const key = (state) => {
    const run = runFunctions(
      dir,
      ['upstream_baseline_key', 'test_scope_key'],
      `latest=v1.1.0 latest_ref=${RELEASE} UPSTREAM_ROOT='${dir}/upstream' VITEST_WORKERS=3 ${state}; cd '${repo}'; upstream_baseline_key`
    )
    assert.equal(run.status, 0, run.stderr)
    return run.stdout.trim()
  }
  const related = key("TEST_SCOPE=related RELATED_UPSTREAM_SOURCES='src/a.ts'")
  assert.equal(related, key("TEST_SCOPE=related RELATED_UPSTREAM_SOURCES='src/a.ts'"))
  assert.notEqual(
    related,
    key("TEST_SCOPE=related RELATED_UPSTREAM_SOURCES=$'src/a.ts\\nsrc/b.ts'")
  )
  assert.notEqual(related, key('TEST_SCOPE=full RELATED_UPSTREAM_SOURCES='))
})

// App-build configs (electron-vite, the web build) never feed vitest, and the
// fork keeps a permanent electron.vite.config.ts change, so they stay related.
test('given only an app-build config changed, the gate stays related', (t) => {
  for (const input of [
    'electron.vite.config.ts',
    'vite.web.config.ts',
    'config/electron-vite-target.config.cts'
  ]) {
    const run = selectScope(t, ':', { ...RELATED_CHANGES, [input]: 'changed\n' })
    assert.equal(run.status, 0, `${input}: ${run.stderr}`)
    assert.match(run.stdout, /^scope=related\n/, input)
  }
})
