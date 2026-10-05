import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  previousReleaseTag,
  resolveUntouchedConflicts,
  untouchedConflicts
} from './resolve-untouched-conflicts.mjs'

// Why: fixtures must not depend on the user's git config (signing, default branch, identity).
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com'
})

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// The sync script's own fetches from upstream, so fixtures exercise the real commands.
const UPSTREAM_FETCHES = [
  ...readFileSync(new URL('./orca-fork-sync.sh', import.meta.url), 'utf8').matchAll(
    /^git (fetch [^|\n]*\bupstream\b[^|\n]*) \|\| fail /gm
  )
].map((match) => match[1].split(' ').map((arg) => arg.replace(/^'(.*)'$/, '$1')))
const UPSTREAM_TAG_FETCH = UPSTREAM_FETCHES.find((args) =>
  args.some((arg) => arg.endsWith(':refs/upstream-tags/*'))
)

const git = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

function newRepo(t) {
  const repo = join(tempDir(t, 'conflicts-'), 'upstream')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  return repo
}

function commit(repo, files, message) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      git(repo, 'rm', '-q', '--', path)
    } else {
      writeFileSync(join(repo, path), content)
      git(repo, 'add', '--', path)
    }
  }
  git(repo, 'commit', '-q', '--allow-empty', '-m', message)
  return git(repo, 'rev-parse', 'HEAD')
}

const release = (repo, tag) => git(repo, 'tag', '-a', '-m', tag, tag)

// Like the sync clone: upstream is a remote whose tags are also fetched into
// their own namespace, so a fork-only tag can never pose as an upstream release.
function forkOf(t, upstream, start) {
  const fork = join(tempDir(t, 'conflicts-'), 'fork repo')
  execFileSync('git', ['clone', '-q', '--origin', 'upstream', upstream, fork])
  git(fork, 'checkout', '-q', '-b', 'fork', start)
  git(fork, ...UPSTREAM_TAG_FETCH)
  return fork
}

const conflicted = (repo) =>
  git(repo, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean).sort()

// Upstream cut release v1.0.0 from a branch that diverged from main, so merging
// main's v1.1.0 conflicts even in files the fork never touched.
function forkMidMerge(t) {
  const upstream = newRepo(t)
  commit(
    upstream,
    {
      'shared.txt': 'base\n',
      'patched.txt': 'base\n',
      'retired.txt': 'base\n',
      'fork-deleted.txt': 'base\n',
      'dropped.txt': 'base\n'
    },
    'base'
  )
  git(upstream, 'checkout', '-q', '-b', 'release')
  commit(
    upstream,
    { 'shared.txt': 'release\n', 'retired.txt': 'release\n', 'dropped.txt': null },
    'release fixes'
  )
  release(upstream, 'v1.0.0')
  git(upstream, 'checkout', '-q', 'main')
  commit(
    upstream,
    {
      'shared.txt': 'upstream next\n',
      'patched.txt': 'upstream next\n',
      'retired.txt': null,
      'fork-deleted.txt': 'upstream next\n',
      'dropped.txt': 'upstream next\n'
    },
    'next release'
  )
  release(upstream, 'v1.1.0')
  const repo = forkOf(t, upstream, 'v1.0.0')
  const preMerge = commit(
    repo,
    { 'patched.txt': 'fork\n', 'fork-deleted.txt': null },
    'fork patches'
  )
  const merge = spawnSync(
    'git',
    ['-C', repo, 'merge', '--no-ff', '--no-edit', 'refs/upstream-tags/v1.1.0'],
    { encoding: 'utf8' }
  )
  assert.notEqual(merge.status, 0, 'fixture merge must conflict')
  return { repo, preMerge }
}

test('given several upstream release tags, the previous release is the highest stable one the commit contains', (t) => {
  const upstream = newRepo(t)
  const older = commit(upstream, {}, 'one')
  release(upstream, 'v1.9.0')
  commit(upstream, {}, 'two')
  release(upstream, 'v1.10.0')
  commit(upstream, {}, 'three')
  release(upstream, 'v1.10.1-rc.1')
  git(upstream, 'checkout', '-q', '-b', 'other', older)
  commit(upstream, {}, 'unmerged release')
  release(upstream, 'v2.0.0')
  const fork = forkOf(t, upstream, 'v1.10.1-rc.1')
  assert.equal(previousReleaseTag(fork, 'HEAD'), 'refs/upstream-tags/v1.10.0')
})

test('given no upstream release tag in the history, there is no previous release', (t) => {
  const upstream = newRepo(t)
  commit(upstream, {}, 'one')
  release(upstream, 'v1.0.0-rc.1')
  const fork = forkOf(t, upstream, 'main')
  assert.equal(previousReleaseTag(fork, 'HEAD'), null)
})

test('given the previous upstream release is not an ancestor of the incoming one, it is still the base', (t) => {
  const { repo, preMerge } = forkMidMerge(t)
  const lineage = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', 'v1.0.0', 'v1.1.0'])
  assert.equal(lineage.status, 1, 'fixture releases must diverge')
  assert.equal(previousReleaseTag(repo, preMerge), 'refs/upstream-tags/v1.0.0')
})

test('given a release tag deleted upstream, the next tag fetch stops selecting it and keeps other refs', (t) => {
  const upstream = newRepo(t)
  commit(upstream, {}, 'one')
  release(upstream, 'v1.0.0')
  commit(upstream, {}, 'two')
  release(upstream, 'v1.1.0')
  git(upstream, 'branch', 'feature')
  const fork = forkOf(t, upstream, 'main')
  git(fork, 'tag', 'v9.0.0')
  assert.equal(previousReleaseTag(fork, 'HEAD'), 'refs/upstream-tags/v1.1.0')
  git(upstream, 'tag', '-d', 'v1.1.0')
  git(upstream, 'branch', '-D', 'feature')
  git(fork, ...UPSTREAM_TAG_FETCH)
  assert.equal(previousReleaseTag(fork, 'HEAD'), 'refs/upstream-tags/v1.0.0')
  assert.equal(git(fork, 'tag', '--list', 'v9.0.0'), 'v9.0.0')
  assert.equal(git(fork, 'tag', '--list', 'v1.1.0'), 'v1.1.0')
  assert.notEqual(git(fork, 'rev-parse', '--verify', 'refs/remotes/upstream/feature'), '')
})

test('given a fork tag sharing an upstream release name, the sync fetches succeed and keep both apart', (t) => {
  const upstream = newRepo(t)
  commit(upstream, {}, 'one')
  release(upstream, 'v1.0.0')
  const fork = forkOf(t, upstream, 'v1.0.0')
  const forkPatch = commit(fork, {}, 'fork patch')
  git(fork, 'tag', '-a', '-m', 'fork', 'v1.1.0')
  const upstreamRelease = commit(upstream, {}, 'two')
  release(upstream, 'v1.1.0')
  commit(upstream, {}, 'three')
  release(upstream, 'v1.2.0')
  assert.ok(UPSTREAM_FETCHES.length > 0, 'the script fetches from upstream')
  for (const args of UPSTREAM_FETCHES) {
    git(fork, ...args)
  }
  assert.equal(git(fork, 'rev-parse', 'refs/upstream-tags/v1.1.0^{commit}'), upstreamRelease)
  assert.equal(git(fork, 'rev-parse', 'refs/tags/v1.1.0^{commit}'), forkPatch)
  assert.equal(git(fork, 'tag', '--list', 'v1.2.0'), '')
})

test('given conflicts, only paths the fork never modified since its release are untouched', (t) => {
  const { repo, preMerge } = forkMidMerge(t)
  assert.deepEqual(conflicted(repo), [
    'dropped.txt',
    'fork-deleted.txt',
    'patched.txt',
    'retired.txt',
    'shared.txt'
  ])
  assert.deepEqual(untouchedConflicts(repo, preMerge), ['retired.txt', 'shared.txt'])
})

test('given a fork-only release tag on the fork patches, fork-modified files are not untouched', (t) => {
  const { repo, preMerge } = forkMidMerge(t)
  git(repo, 'tag', 'v9.0.0', preMerge)
  assert.deepEqual(untouchedConflicts(repo, preMerge), ['retired.txt', 'shared.txt'])
})

test('given a content conflict in a file the fork never modified, the upstream version is staged', (t) => {
  const { repo, preMerge } = forkMidMerge(t)
  assert.deepEqual(resolveUntouchedConflicts(repo, preMerge), ['retired.txt', 'shared.txt'])
  assert.equal(readFileSync(join(repo, 'shared.txt'), 'utf8'), 'upstream next\n')
  assert.equal(git(repo, 'show', ':shared.txt'), 'upstream next')
  assert.ok(!conflicted(repo).includes('shared.txt'))
})

test('given upstream deleted a file the fork never modified, the deletion is followed', (t) => {
  const { repo, preMerge } = forkMidMerge(t)
  resolveUntouchedConflicts(repo, preMerge)
  assert.equal(existsSync(join(repo, 'retired.txt')), false)
  assert.equal(git(repo, 'ls-files', '--', 'retired.txt'), '')
})

test('given conflicts in files the fork modified, deleted, or never had, they stay conflicted', (t) => {
  const { repo, preMerge } = forkMidMerge(t)
  resolveUntouchedConflicts(repo, preMerge)
  assert.deepEqual(conflicted(repo), ['dropped.txt', 'fork-deleted.txt', 'patched.txt'])
  assert.match(readFileSync(join(repo, 'patched.txt'), 'utf8'), /^<<<<<<< /m)
})

test('given only a local copy of the previous release tag, every conflict is left for review', (t) => {
  const { repo, preMerge } = forkMidMerge(t)
  git(repo, 'update-ref', '-d', 'refs/upstream-tags/v1.0.0')
  assert.deepEqual(resolveUntouchedConflicts(repo, preMerge), [])
  assert.equal(conflicted(repo).length, 5)
})

test('given the CLI path contains spaces, the CLI resolves untouched conflicts and prints them', (t) => {
  const { repo, preMerge } = forkMidMerge(t)
  const dir = join(tempDir(t, 'conflicts-cli-'), 'Application Support')
  mkdirSync(dir)
  const cli = join(dir, 'resolve-untouched-conflicts.mjs')
  copyFileSync(new URL('./resolve-untouched-conflicts.mjs', import.meta.url), cli)
  const run = spawnSync(process.execPath, [cli, repo, preMerge], { encoding: 'utf8' })
  assert.equal(run.stderr, '')
  assert.equal(run.status, 0)
  assert.equal(run.stdout, 'retired.txt\nshared.txt\n')
  assert.deepEqual(conflicted(repo), ['dropped.txt', 'fork-deleted.txt', 'patched.txt'])
})

test('given missing arguments, the CLI prints usage and fails', () => {
  const run = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./resolve-untouched-conflicts.mjs', import.meta.url))],
    { encoding: 'utf8' }
  )
  assert.equal(run.status, 2)
  assert.match(run.stderr, /^usage: resolve-untouched-conflicts\.mjs/)
})
