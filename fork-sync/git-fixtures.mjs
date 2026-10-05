// Shared git fixtures for the fork-sync tests. Importing this module makes git
// calls in this process and its children ignore the user's git config.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: fixtures must not depend on the user's git config (signing, default branch, identity, hooks path).
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com'
})

export function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// The sync script's own fetches from upstream, so fixtures exercise the real commands.
export const UPSTREAM_FETCHES = [
  ...readFileSync(new URL('./orca-fork-sync.sh', import.meta.url), 'utf8').matchAll(
    /^git (fetch [^|\n]*\bupstream\b[^|\n]*) \|\| fail /gm
  )
].map((match) => match[1].split(' ').map((arg) => arg.replace(/^'(.*)'$/, '$1')))
export const UPSTREAM_TAG_FETCH = UPSTREAM_FETCHES.find((args) =>
  args.some((arg) => arg.endsWith(':refs/upstream-tags/*'))
)

export const git = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

export function newRepo(t) {
  const repo = join(tempDir(t, 'conflicts-'), 'upstream')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  return repo
}

export function commit(repo, files, message) {
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

export const release = (repo, tag) => git(repo, 'tag', '-a', '-m', tag, tag)

// Like the sync clone: upstream is a remote whose tags are also fetched into
// their own namespace, so a fork-only tag can never pose as an upstream release.
export function forkOf(t, upstream, start) {
  const fork = join(tempDir(t, 'conflicts-'), 'fork repo')
  execFileSync('git', ['clone', '-q', '--origin', 'upstream', upstream, fork])
  git(fork, 'checkout', '-q', '-b', 'fork', start)
  git(fork, ...UPSTREAM_TAG_FETCH)
  return fork
}

export const conflicted = (repo) =>
  git(repo, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean).sort()

const lines = (...items) => `${items.join('\n')}\n`
const BASE = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const withBlockAfter = (index) => lines(...BASE.slice(0, index), 'BLOCK', ...BASE.slice(index))

export const SILENT_DUPLICATE = {
  release: withBlockAfter(2),
  upstream: withBlockAfter(8),
  patchedFork: lines('one fork', ...BASE.slice(1)),
  patchedMerged: lines('one fork', ...BASE.slice(1, 8), 'nine upstream')
}

// Upstream's previous release v1.0.0 sits on a release branch that diverged
// from main, and both lines added the same block to ready.ts at different
// places. The fork never touched ready.ts, so merging v1.1.0 cleanly keeps
// both copies. The fork did patch patched.txt, which upstream also changed.
export function forkBeforeSilentDuplicate(t) {
  const upstream = newRepo(t)
  commit(
    upstream,
    {
      'ready.ts': lines(...BASE),
      'patched.txt': lines(...BASE),
      'gone.txt': 'base\n'
    },
    'base'
  )
  git(upstream, 'checkout', '-q', '-b', 'release')
  commit(
    upstream,
    { 'ready.ts': SILENT_DUPLICATE.release, 'backport.txt': 'release\n', 'gone.txt': null },
    'release fixes'
  )
  release(upstream, 'v1.0.0')
  git(upstream, 'checkout', '-q', 'main')
  commit(
    upstream,
    {
      'ready.ts': SILENT_DUPLICATE.upstream,
      'patched.txt': lines(...BASE.slice(0, 8), 'nine upstream')
    },
    'next release'
  )
  release(upstream, 'v1.1.0')
  const repo = forkOf(t, upstream, 'v1.0.0')
  const preMerge = commit(repo, { 'patched.txt': SILENT_DUPLICATE.patchedFork }, 'fork patch')
  return { repo, preMerge }
}
