#!/usr/bin/env node
// Compares vitest runs of the fork against runs of the same upstream release.
//
//   compare-test-failures.mjs <upstream.json[,more.json]> <upstream-root> <fork.json> <fork-root> [required-file...]
//     Prints failures present in the fork but not confirmed upstream; exits 1 if any.
//     Every upstream report must reproduce a failure for it to count as upstream's own.
//     Required files must appear in the fork report (used for retries).
//   compare-test-failures.mjs --files <report.json> <root>
//     Prints the test files that have failures, for a targeted re-run.
//
// Each <report>.json may have a sibling <report>.log holding the default
// reporter's console output, which is the only place vitest records unhandled errors.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { relative } from 'node:path'

const UNATTRIBUTED_PREFIX = '(unhandled error without a test file)'

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

export function unhandledErrorIds(consoleLog) {
  const ids = new Set()
  // eslint-disable-next-line no-control-regex -- strips ANSI color codes from reporter output
  const plain = consoleLog.replace(/\u001b\[[0-9;]*m/g, '')
  // The reporter's block is the last banner followed by its "Vitest caught" line.
  const section = [...plain.matchAll(/^⎯+ Unhandled Errors ⎯+$/gm)]
    .map((banner) => plain.slice(banner.index).split(/^ Test Files /m)[0])
    .findLast((candidate) => /^Vitest caught \d+ unhandled error/m.test(candidate))
  if (section === undefined) {
    return ids
  }
  const caught = section.match(/^Vitest caught (\d+) unhandled error/m)
  const total = caught ? Number(caught[1]) : 0
  const perFile = new Map()
  let attributed = 0
  for (const match of section.matchAll(/^This error originated in "([^"]+)" test file/gm)) {
    const occurrence = (perFile.get(match[1]) ?? 0) + 1
    perFile.set(match[1], occurrence)
    ids.add(`${match[1]} > (unhandled error) #${occurrence}`)
    attributed += 1
  }
  for (let n = 1; n <= total - attributed; n += 1) {
    ids.add(`${UNATTRIBUTED_PREFIX} #${n}`)
  }
  return ids
}

export function reportFailureIds(reportPath, root, requiredFiles = []) {
  const ids = failingTestIds(JSON.parse(readFileSync(reportPath, 'utf8')), root, requiredFiles)
  const logPath = reportPath.replace(/\.json$/, '.log')
  if (logPath !== reportPath && existsSync(logPath)) {
    for (const id of unhandledErrorIds(readFileSync(logPath, 'utf8'))) {
      ids.add(id)
    }
  }
  return ids
}

// A failure only counts as upstream's own when every upstream run reproduces it,
// so a one-off flake cannot mask a fork regression in the same test.
export function confirmedFailures(idSets) {
  const [first, ...rest] = idSets
  return new Set([...(first ?? [])].filter((id) => rest.every((ids) => ids.has(id))))
}

export function newFailures(upstreamIds, forkIds) {
  return [...forkIds].filter((id) => !upstreamIds.has(id)).sort()
}

export function filesToRerun(ids) {
  return [
    ...new Set(
      [...ids].filter((id) => !id.startsWith(UNATTRIBUTED_PREFIX)).map((id) => id.split(' > ')[0])
    )
  ].sort()
}

function main(args) {
  if (args[0] === '--files') {
    const [, reportPath, root] = args
    for (const file of filesToRerun(reportFailureIds(reportPath, root))) {
      console.log(file)
    }
    return 0
  }
  const [upstreamReports, upstreamRoot, forkReport, forkRoot, ...requiredFiles] = args
  if (!forkRoot) {
    console.error(
      'usage: compare-test-failures.mjs <upstream.json[,more.json]> <upstream-root> <fork.json> <fork-root> [required-file...]'
    )
    return 2
  }
  const introduced = newFailures(
    confirmedFailures(
      upstreamReports.split(',').map((path) => reportFailureIds(path, upstreamRoot))
    ),
    reportFailureIds(forkReport, forkRoot, requiredFiles)
  )
  for (const id of introduced) {
    console.log(id)
  }
  return introduced.length > 0 ? 1 : 0
}

// Why: compare real paths; the install dir has spaces and macOS temp dirs are symlinked.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)))
}
