#!/usr/bin/env node
// Gives files the fork has no stake in the upstream release's exact content.
//
//   resolve-untouched-conflicts.mjs <repo> <pre-merge-commit>
//     Run while a merge of an upstream release is stopped on conflicts. Every
//     conflicted path the fork never modified since the previous release it
//     merged takes the upstream side and is staged. Prints each resolved path.
//   resolve-untouched-conflicts.mjs --normalize <repo> <pre-merge-commit> <upstream-ref>
//     Run on an uncommitted merge. Every path that differs from <upstream-ref>
//     and that the fork never modified is restored to <upstream-ref> and staged,
//     including ones git merged cleanly. Prints each restored path.
//
// Such conflicts and differences come from upstream itself (a release cut from
// a branch that diverged from the next release, where both lines carry the
// same change at different places and a clean merge keeps both copies), so
// upstream's newer version is correct.
// Releases are read from upstream's own tags, which the sync fetches into
// refs/upstream-tags/, so a fork-only tag can never pass for a release.
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'

const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/
const UPSTREAM_TAGS = 'refs/upstream-tags/'

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })

const nulSeparated = (output) => output.split('\0').filter(Boolean)

const releaseName = (ref) => ref.slice(UPSTREAM_TAGS.length)

const versionOf = (ref) => releaseName(ref).match(STABLE_TAG).slice(1).map(Number)

function compareVersions(a, b) {
  const [left, right] = [versionOf(a), versionOf(b)]
  return left.map((part, i) => part - right[i]).find((diff) => diff !== 0) ?? 0
}

// The fork only merges stable releases, so the newest one in its history is its base.
export function previousReleaseTag(repo, commit) {
  const refs = git(repo, 'for-each-ref', '--merged', commit, '--format=%(refname)', UPSTREAM_TAGS)
    .split('\n')
    .filter((ref) => STABLE_TAG.test(releaseName(ref)))
  return refs.sort(compareVersions).at(-1) ?? null
}

function conflictedPaths(repo) {
  return nulSeparated(git(repo, 'diff', '--name-only', '--diff-filter=U', '-z')).sort()
}

function existsAt(repo, commit, path) {
  return git(repo, 'ls-tree', '-z', '--name-only', commit, '--', path) !== ''
}

function unchangedBetween(repo, from, to, path) {
  try {
    git(repo, 'diff', '--quiet', from, to, '--', path)
    return true
  } catch (error) {
    if (error.status === 1) {
      return false
    }
    throw error
  }
}

// A path the fork never had cannot be judged by its own history (it may hold
// content upstream moved there by a rename), so it is left for review.
function untouchedPaths(repo, preMerge, paths) {
  const release = previousReleaseTag(repo, preMerge)
  if (release === null) {
    return []
  }
  return paths.filter(
    (path) => existsAt(repo, preMerge, path) && unchangedBetween(repo, release, preMerge, path)
  )
}

export function untouchedConflicts(repo, preMerge) {
  return untouchedPaths(repo, preMerge, conflictedPaths(repo))
}

function upstreamHasPath(repo, path) {
  return nulSeparated(git(repo, 'ls-files', '-u', '-z', '--', path)).some(
    (entry) => entry.split('\t')[0].split(' ')[2] === '3'
  )
}

export function resolveUntouchedConflicts(repo, preMerge) {
  const resolved = untouchedConflicts(repo, preMerge)
  for (const path of resolved) {
    if (upstreamHasPath(repo, path)) {
      git(repo, 'checkout', '--theirs', '--', path)
      git(repo, 'add', '--', path)
    } else {
      git(repo, 'rm', '--quiet', '--', path)
    }
  }
  return resolved
}

function pathsDifferingFrom(repo, ref) {
  return nulSeparated(git(repo, 'diff', '--name-only', '--no-renames', '-z', ref, '--')).sort()
}

export function normalizeUntouchedPaths(repo, preMerge, upstreamRef) {
  const restored = untouchedPaths(repo, preMerge, pathsDifferingFrom(repo, upstreamRef))
  for (const path of restored) {
    if (existsAt(repo, upstreamRef, path)) {
      git(repo, 'checkout', upstreamRef, '--', path)
    } else {
      git(repo, 'rm', '--quiet', '--', path)
    }
  }
  return restored
}

function main(args) {
  const normalize = args[0] === '--normalize'
  const [repo, preMerge, upstreamRef] = normalize ? args.slice(1) : args
  if (!preMerge || (normalize && !upstreamRef)) {
    console.error(
      'usage: resolve-untouched-conflicts.mjs [--normalize] <repo> <pre-merge-commit> [<upstream-ref>]'
    )
    return 2
  }
  const paths = normalize
    ? normalizeUntouchedPaths(repo, preMerge, upstreamRef)
    : resolveUntouchedConflicts(repo, preMerge)
  for (const path of paths) {
    console.log(path)
  }
  return 0
}

// Why: compare real paths; the install dir has spaces and macOS temp dirs are symlinked.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)))
}
