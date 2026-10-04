---
name: known-local-test-failures
description: Tests that fail on clean HEAD on this machine (env/timing), so they are not regressions from a change
metadata:
  type: project
---

As of 2026-10-04 on feat/cross-workspace-pane-splits, these fail on clean HEAD locally, independent of changes:
- src/main/runtime/structured-session-cli-login-shell.live-shell.test.ts (zsh login shell resolves the user's own `orca` CLI)
- src/main/runtime/rpc/terminal-output-frame-chunks-equivalence.test.ts "fuzzes 800 near-cap payloads" (30s timeout)
- src/renderer/src/lib/palette-match/palette-match-performance.test.ts flakes only under full-suite parallel load; passes alone.

**Why:** saves re-bisecting them when running broad suites.
**How to apply:** confirm with `git stash` + rerun before reporting them; re-verify since this goes stale.
