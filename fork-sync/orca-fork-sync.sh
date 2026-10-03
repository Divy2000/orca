#!/bin/bash
# Weekly fork sync: merge the latest stable upstream Orca release into the
# personal build branch, let a headless Claude session resolve conflicts and
# repair merge breakage, verify, build a signed app, push, and install it once
# Orca is quit. Runs from a copy outside the repo (see install.sh) so merges can
# rewrite this file without corrupting the running script, and works in its own
# clone so it can never touch edits in the developer checkout.
set -euo pipefail

BRANCH="divy/stable"
FORK_URL="https://github.com/Divy2000/orca.git"
UPSTREAM_URL="https://github.com/stablyai/orca.git"
UPSTREAM_REPO="stablyai/orca"
# Why: no spaces in work paths; native module builds break on them.
STATE_DIR="$HOME/.orca-fork-sync"
REPO="$STATE_DIR/repo"
UPSTREAM_WORKTREE="$STATE_DIR/upstream"
LOG_DIR="$HOME/Library/Logs/orca-fork-sync"
APP_PATH="/Applications/Orca.app"
SIGN_IDENTITY="${ORCA_FORK_SIGN_IDENTITY:-Apple Development: Divy Kamlesh Patel (Q957WMRP9V)}"
INSTALL_WAIT_SECONDS=$((7 * 24 * 3600))
CLAUDE_MAX_TURNS=200
COMPARE="$STATE_DIR/bin/compare-test-failures.mjs"
INTRODUCED_FILE="$STATE_DIR/introduced-failures.txt"

mkdir -p "$STATE_DIR" "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d_%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

# Why: repo policy; Electron-backed tests must never surface windows on the desktop.
export ORCA_BACKGROUND_LAUNCH=1
export PATH="$STATE_DIR/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Logs go to stderr so functions can return values on stdout.
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }

notify() {
  local title="$1" message="$2"
  osascript -e "display notification \"${message//\"/\\\"}\" with title \"${title//\"/\\\"}\"" || true
}

fail() {
  log "FAILED: $*"
  notify "Orca fork sync failed" "$* - see $LOG_FILE"
  exit 1
}

LOCK_FILE="$STATE_DIR/sync.lock"
# Why: shlock creates the pid file atomically, so concurrent starts cannot both win.
if ! shlock -f "$LOCK_FILE" -p $$; then
  holder="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  # A reused pid must not keep the lock alive; require it to be this script.
  if [[ -n "$holder" ]] && [[ "$(ps -p "$holder" -o command= 2>/dev/null)" =~ ^(/bin/)?bash\ "$STATE_DIR/bin/orca-fork-sync.sh"$ ]]; then
    log "Another sync (pid $holder) is running; exiting."
    exit 0
  fi
  log "Removing stale lock from pid ${holder:-unknown}."
  rm -f "$LOCK_FILE"
  shlock -f "$LOCK_FILE" -p $$ || { log "Lost the lock race; exiting."; exit 0; }
fi
trap '[[ "$(cat "$LOCK_FILE" 2>/dev/null)" == "$$" ]] && rm -f "$LOCK_FILE"' EXIT

run_claude() {
  local task="$1" prompt
  log "Starting headless Claude session: $task"
  # Why: a heredoc inside $(...) misparses quotes under macOS /bin/bash 3.2.
  IFS= read -r -d '' prompt <<EOF || true
You are maintaining the personal Orca fork at $REPO on branch $BRANCH.
This branch is an upstream stable release plus personal patches (self-managed
updater mode, cross-workspace pane splits, and other fork features). Follow
AGENTS.md. pnpm is available as \`pnpm\`.

Task: $task

Rules:
- Preserve the intent of BOTH sides: keep every upstream change and keep every
  fork feature working. Never drop a fork feature to make a conflict go away.
- Never delete, skip, or weaken tests to make them pass.
- Do not commit, push, rebase, reset, or abort the merge. Leave resolved files
  staged with \`git add\`.
- When done, print a short summary of what you changed and why.
EOF
  (cd "$REPO" && claude -p --dangerously-skip-permissions --max-turns "$CLAUDE_MAX_TURNS" "$prompt") || return 1
}

wait_and_install() {
  local staged="$1" commit="$2"
  local notified=false deadline=$(( $(date +%s) + INSTALL_WAIT_SECONDS ))
  while pgrep -f "^$APP_PATH/Contents/MacOS/Orca" >/dev/null; do
    if [[ "$notified" == false ]]; then
      notified=true
      notify "Orca update ready" "Quit Orca to install the fork build ($commit). It reopens automatically."
      log "Orca is running; waiting for it to quit before installing."
    fi
    if (( $(date +%s) >= deadline )); then
      fail "Orca stayed open for 7 days; staged build left at $staged"
    fi
    sleep 60
  done

  local backup="$STATE_DIR/previous/Orca.app"
  rm -rf "$STATE_DIR/previous"
  mkdir -p "$STATE_DIR/previous"
  if [[ -d "$APP_PATH" ]]; then
    mv "$APP_PATH" "$backup"
  fi
  if ! ditto "$staged" "$APP_PATH" || ! codesign --verify --deep --strict "$APP_PATH"; then
    rm -rf "$APP_PATH"
    [[ -d "$backup" ]] && mv "$backup" "$APP_PATH"
    fail "install of $commit failed; previous Orca restored"
  fi
  echo "$commit" > "$STATE_DIR/installed-commit"
  log "Installed $commit to $APP_PATH (previous app kept at $backup)."
  notify "Orca updated" "Fork build $commit installed."
  open -a "$APP_PATH" || true
}

# Why: `pnpm test --reporter=json` is parsed by pnpm itself, so call vitest the
# way the repo's test script does. The default reporter is kept alongside JSON
# because unhandled errors only appear in its console summary.
run_unit_tests() {
  local report="$1" console_log="$2"; shift 2
  node config/scripts/ensure-native-runtime.mjs --runtime=node >"$console_log" 2>&1 \
    && pnpm exec vitest run --config config/vitest.config.ts \
      --reporter=json --reporter=default --outputFile.json="$report" "$@" >>"$console_log" 2>&1
}

unhandled_error_count() {
  local count
  count="$(grep -oE 'Vitest caught [0-9]+ unhandled error' "$1" | grep -oE '[0-9]+' | head -1 || true)"
  echo "${count:-0}"
}

# Why: the upstream release itself fails some tests on this machine (CI-only
# fixtures, local toolchain differences), so the gate is "the fork adds no
# failures the same release does not already have", not "everything passes".
# The baseline is rebuilt every run so it reflects the same toolchain as the fork run.
upstream_report() {
  local report="$STATE_DIR/upstream-tests.json"
  rm -f "$report"
  log "Running upstream $latest test suite for the failure baseline."
  git worktree remove --force "$UPSTREAM_WORKTREE" 2>/dev/null || true
  git worktree add --force --detach "$UPSTREAM_WORKTREE" "$latest" >/dev/null
  (cd "$UPSTREAM_WORKTREE" && pnpm install --frozen-lockfile >/dev/null 2>&1 \
    && { run_unit_tests "$report" "$STATE_DIR/upstream-tests.log" || true; })
  git worktree remove --force "$UPSTREAM_WORKTREE"
  [[ -s "$report" ]] || return 1
  echo "$report"
}

verify() {
  node --test fork-sync/compare-test-failures.test.mjs >&2 || return 1
  # Why: build:mac packages x64 and arm64, which needs both native variants installed.
  pnpm run install:release >&2 || return 1
  pnpm run tc >&2 || return 1
  local baseline
  local fork_report="$STATE_DIR/fork-tests.json" retry_report="$STATE_DIR/fork-retry.json"
  baseline="$(upstream_report)" || { log "Could not produce the upstream test report."; return 1; }
  rm -f "$fork_report" "$retry_report"
  run_unit_tests "$fork_report" "$STATE_DIR/fork-tests.log" || true
  [[ -s "$fork_report" ]] || { log "Fork test run produced no report."; return 1; }

  local upstream_unhandled fork_unhandled
  upstream_unhandled="$(unhandled_error_count "$STATE_DIR/upstream-tests.log")"
  fork_unhandled="$(unhandled_error_count "$STATE_DIR/fork-tests.log")"
  if (( fork_unhandled > upstream_unhandled )); then
    log "Fork run has $fork_unhandled unhandled errors vs $upstream_unhandled upstream (see $STATE_DIR/fork-tests.log)."
    echo "unhandled errors: fork $fork_unhandled, upstream $upstream_unhandled (see $STATE_DIR/fork-tests.log)" > "$INTRODUCED_FILE"
    return 1
  fi

  if node "$COMPARE" "$baseline" "$UPSTREAM_WORKTREE" "$fork_report" "$REPO" > "$INTRODUCED_FILE"; then
    return 0
  fi
  # Re-run only the affected files once so a flaky test cannot block the sync.
  local files=()
  while IFS= read -r file; do files+=("$file"); done < <(sed 's/ > .*//' "$INTRODUCED_FILE" | sort -u)
  log "Re-running ${#files[@]} file(s) with fork-only failures."
  run_unit_tests "$retry_report" "$STATE_DIR/fork-retry.log" "${files[@]}" || true
  if [[ -s "$retry_report" ]] \
    && node "$COMPARE" "$baseline" "$UPSTREAM_WORKTREE" "$retry_report" "$REPO" "${files[@]}" > "$INTRODUCED_FILE"; then
    return 0
  fi
  log "Fork-only test failures:"; cat "$INTRODUCED_FILE" >&2
  return 1
}

# Keep the Mac awake for merge, verification and build; installation waits
# without it so a long wait for Orca to quit does not block sleep.
caffeinate -i -w $$ &
caffeinate_pid=$!

if [[ ! -d "$REPO/.git" ]]; then
  log "Cloning $FORK_URL into $REPO."
  git clone --quiet --filter=blob:none --branch "$BRANCH" "$FORK_URL" "$REPO"
  git -C "$REPO" remote add upstream "$UPSTREAM_URL"
fi
cd "$REPO"
git fetch --quiet origin
git fetch --quiet upstream --tags
# This clone belongs to the job alone, so it always restarts from the pushed branch.
git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
git reset --quiet --hard "origin/$BRANCH"
git clean -fdq

latest="$(gh release view --repo "$UPSTREAM_REPO" --json tagName,isPrerelease --jq 'select(.isPrerelease == false) | .tagName')"
[[ "$latest" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "unexpected latest release tag '$latest'"
log "Latest stable upstream release: $latest"

pre_merge="$(git rev-parse HEAD)"
merged_new_release=false
if git merge-base --is-ancestor "$latest" HEAD; then
  log "$latest is already merged into $BRANCH."
else
  merged_new_release=true
  if ! git merge --no-ff --no-edit -m "chore(fork): merge upstream $latest" "$latest"; then
    log "Merge has conflicts: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"
    run_claude "Resolve every merge conflict from merging upstream release $latest into $BRANCH. Run \`git diff --name-only --diff-filter=U\` to list them." \
      || { git merge --abort; fail "Claude conflict resolution session failed"; }
    changed_by_merge=()
    while IFS= read -r file; do changed_by_merge+=("$file"); done < <(git diff --name-only "$pre_merge" --)
    if [[ -n "$(git diff --name-only --diff-filter=U)" ]] \
      || { (( ${#changed_by_merge[@]} > 0 )) && git grep -nE '^(<<<<<<<|>>>>>>>) ' -- "${changed_by_merge[@]}" >/dev/null; }; then
      git merge --abort
      fail "conflicts remain after Claude session"
    fi
    git commit --no-edit || { git merge --abort; fail "could not commit the resolved merge"; }
  fi
fi

current="$(git rev-parse --short=12 HEAD)"
if [[ "$merged_new_release" == false && "$(cat "$STATE_DIR/installed-commit" 2>/dev/null)" == "$current" ]]; then
  log "Installed build already matches $current; nothing to do."
  exit 0
fi

log "Installing dependencies and verifying."
if ! verify; then
  if [[ "$merged_new_release" == false ]]; then
    fail "verification failed on $current without a new merge"
  fi
  run_claude "After merging upstream $latest, either \`pnpm run tc\` fails or the fork has test failures or unhandled errors that the plain upstream release does not (listed in $INTRODUCED_FILE). Find the root cause and fix it so both upstream and fork behavior are preserved." \
    || fail "Claude repair session failed; nothing pushed"
  if ! verify; then
    fail "verification still failing after Claude repair; nothing pushed"
  fi
  git add -A
  git commit -m "fix(fork): repair fork patches after merging upstream $latest"
  current="$(git rev-parse --short=12 HEAD)"
fi

log "Building signed macOS app for $current."
rm -rf dist
ORCA_SELF_MANAGED_UPDATES=1 CSC_NAME="$SIGN_IDENTITY" pnpm run build:mac >&2 || fail "build failed for $current"
case "$(uname -m)" in
  arm64) built_app="dist/mac-arm64/Orca.app" ;;
  *) built_app="dist/mac/Orca.app" ;;
esac
[[ -d "$built_app" ]] || fail "build produced no Orca.app at $built_app"
codesign --verify --deep --strict "$built_app" || fail "built app signature invalid"

git push --quiet origin "$BRANCH" || fail "push of $BRANCH failed"
log "Pushed $BRANCH ($current) to origin."

staged="$STATE_DIR/staged/Orca.app"
rm -rf "$STATE_DIR/staged"
mkdir -p "$STATE_DIR/staged"
ditto "$built_app" "$staged"

kill "$caffeinate_pid" 2>/dev/null || true
wait_and_install "$staged" "$current"
