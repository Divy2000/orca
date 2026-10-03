#!/usr/bin/env node
// Prints tests that fail in the fork run but not in the upstream run, one per
// line, and exits 1 when there are any. Inputs are vitest JSON reports. Extra
// trailing arguments name test files the fork report must contain (retries).
import { readFileSync, realpathSync } from 'node:fs'
import { relative } from 'node:path'

export function failingTestIds(report, root, requiredFiles = []) {
  const ids = new Set()
  const seen = new Set()
  for (const file of report.testResults ?? []) {
    const name = relative(root, file.name)
    seen.add(name)
    const failedAssertions = (file.assertionResults ?? []).filter((a) => a.status === 'failed')
    for (const assertion of failedAssertions) {
      ids.add(`${name} > ${assertion.fullName}`)
    }
    // Load errors and hook failures carry a file-level message, with or without failed assertions.
    if (file.status === 'failed' && (failedAssertions.length === 0 || file.message)) {
      ids.add(`${name} > (file failed)`)
    }
  }
  for (const required of requiredFiles) {
    if (!seen.has(required)) {
      ids.add(`${required} > (file missing from report)`)
    }
  }
  return ids
}

export function newFailures(upstreamIds, forkIds) {
  return [...forkIds].filter((id) => !upstreamIds.has(id)).sort()
}

// Why: compare real paths; the install dir has spaces and macOS temp dirs are symlinked.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  const [upstreamReport, upstreamRoot, forkReport, forkRoot, ...requiredFiles] =
    process.argv.slice(2)
  if (!forkRoot) {
    console.error(
      'usage: compare-test-failures.mjs <upstream.json> <upstream-root> <fork.json> <fork-root> [required-file...]'
    )
    process.exit(2)
  }
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
  const introduced = newFailures(
    failingTestIds(read(upstreamReport), upstreamRoot),
    failingTestIds(read(forkReport), forkRoot, requiredFiles)
  )
  for (const id of introduced) {
    console.log(id)
  }
  process.exit(introduced.length > 0 ? 1 : 0)
}
