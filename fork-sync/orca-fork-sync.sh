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

# Why: the internal disk is nearly full, so disposable run data goes to the
# external scratch volume whenever it is mounted, reached through its stable
# ~/.orca-scratch symlink. Permanent state never lives there.
scratch_dir() {
  local scratch="$1" fallback="$2"
  if [[ -d "$scratch" && -w "$scratch" ]]; then
    printf '%s\n' "$scratch/sync"
  else
    printf '%s\n' "$fallback"
  fi
}
RUN_DIR="$(scratch_dir "$HOME/.orca-scratch" "$STATE_DIR")"
UPSTREAM_WORKTREE="$RUN_DIR/upstream"
FORK_REPORT="$RUN_DIR/fork-tests.json"
RETRY_REPORT="$RUN_DIR/fork-retry.json"
STAGED_DIR="$RUN_DIR/staged"
LOG_DIR="$HOME/Library/Logs/orca-fork-sync"
APP_PATH="/Applications/Orca.app"
SIGN_IDENTITY="${ORCA_FORK_SIGN_IDENTITY:-Apple Development: Divy Kamlesh Patel (Q957WMRP9V)}"
INSTALL_WAIT_SECONDS=$((7 * 24 * 3600))
CLAUDE_MAX_TURNS=200
COMPARE="$STATE_DIR/bin/compare-test-failures.mjs"
RESOLVE_UNTOUCHED="$STATE_DIR/bin/resolve-untouched-conflicts.mjs"
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

# Why: a staged build outlives its run so it can still be installed after the
# install wait gives up; only a newer build or a successful install replaces it.
cleanup_run_data() {
  if [[ -d "$REPO/.git" ]]; then
    git -C "$REPO" worktree remove --force "$UPSTREAM_WORKTREE" 2>/dev/null || true
  fi
  rm -rf "$UPSTREAM_WORKTREE" "$FORK_REPORT" "${FORK_REPORT%.json}.log" "$RETRY_REPORT" "${RETRY_REPORT%.json}.log"
  # Only the link is removed; a real dist/ from a fallback run stays as before.
  if [[ -L "$REPO/dist" ]]; then
    rm -f "$REPO/dist"
  fi
  if [[ "$RUN_DIR" != "$STATE_DIR" ]]; then
    rm -rf "$RUN_DIR/tmp" "$RUN_DIR/build"
    rmdir "$RUN_DIR" 2>/dev/null || true
  fi
  if [[ -d "$REPO/.git" ]]; then
    git -C "$REPO" worktree prune
  fi
}
# Why: earlier versions staged builds in $STATE_DIR; nothing reads that copy
# once staging lives on scratch, and it holds hundreds of MB of internal disk.
# It stays installable by hand until a newer build has been installed.
remove_legacy_staged() {
  local legacy="$STATE_DIR/staged"
  if [[ "$STAGED_DIR" != "$legacy" && -e "$legacy" ]]; then
    log "Removing legacy staged build at $legacy."
    rm -rf "$legacy"
  fi
}
on_exit() {
  cleanup_run_data || log "Could not fully clean run data in $RUN_DIR."
  [[ "$(cat "$LOCK_FILE" 2>/dev/null)" == "$$" ]] && rm -f "$LOCK_FILE"
}
trap on_exit EXIT
# Removes leftovers of a run that was killed before its trap could clean up.
cleanup_run_data
mkdir -p "$RUN_DIR"
if [[ "$RUN_DIR" != "$STATE_DIR" ]]; then
  mkdir -p "$RUN_DIR/tmp"
  export TMPDIR="$RUN_DIR/tmp"
fi
log "Run data directory: $RUN_DIR"
# Why: Node reports the physical cwd, so vitest names upstream test files by the
# real worktree path, not the symlinked one; failure ids are relative to it.
UPSTREAM_ROOT="$(cd "$RUN_DIR" && pwd -P)/upstream"

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

# Why: pgrep cannot see the Orca process on this machine (it once reported Orca
# closed while it ran), and ps comm is argv[0], so ask LaunchServices by bundle
# id and also match any Orca main executable; an unreadable process list counts as running.
orca_running() {
  local asn
  for asn in $(lsappinfo find bundleID=com.stablyai.orca 2>/dev/null | grep -oE 'ASN:[^:]+:'); do
    # Only the installed copy matters; dev builds share the bundle id.
    [[ "$(lsappinfo info -only bundlepath "$asn" 2>/dev/null)" == "\"LSBundlePath\"=\"$APP_PATH\"" ]] && return 0
  done
  local processes
  processes="$(ps -axo command=)" || return 0
  # Anchored: the terminal daemon outlives the app and carries this path as an argument.
  awk -v exe="$APP_PATH/Contents/MacOS/Orca" \
    'index($0, exe) == 1 && (length($0) == length(exe) || substr($0, length(exe) + 1, 1) == " ") { found = 1 }
     END { exit !found }' <<<"$processes"
}

# Why: electron-builder writes the packaged apps through a symlinked dist/, so
# they land on scratch. out/ stays a real directory: electron-builder silently
# leaves a symlinked out/ out of app.asar. The link must not exist before the
# repair commit's `git add -A`, since a symlink does not match the dist/ ignore rule.
prepare_build_output() {
  rm -rf "$REPO/dist"
  if [[ "$RUN_DIR" != "$STATE_DIR" ]]; then
    rm -rf "$RUN_DIR/build/dist"
    mkdir -p "$RUN_DIR/build/dist"
    ln -s "$RUN_DIR/build/dist" "$REPO/dist"
  fi
}

# The last good staged build is only swapped out once its replacement is verified.
stage_build() {
  local built="$1" staged="$STAGED_DIR/Orca.app"
  local incoming="$STAGED_DIR/Orca.app.new" outgoing="$STAGED_DIR/Orca.app.old"
  mkdir -p "$STAGED_DIR"
  rm -rf "$incoming" "$outgoing"
  if ! ditto "$built" "$incoming" || ! codesign --verify --deep --strict "$incoming"; then
    rm -rf "$incoming"
    fail "could not stage a verified build at $STAGED_DIR"
  fi
  if [[ -e "$staged" ]]; then
    mv "$staged" "$outgoing"
  fi
  if ! mv "$incoming" "$staged"; then
    if [[ -e "$outgoing" ]]; then
      mv "$outgoing" "$staged"
    fi
    rm -rf "$incoming"
    fail "could not move the verified build into $staged; previous staged build kept"
  fi
  rm -rf "$outgoing"
}

wait_and_install() {
  local staged="$1" commit="$2"
  local notified=false deadline=$(( $(date +%s) + INSTALL_WAIT_SECONDS ))
  while orca_running; do
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

  # Why: the staged build may sit on an ejectable volume for days; check it
  # before the installed app is moved aside.
  if [[ ! -d "$staged" ]] || ! codesign --verify --deep --strict "$staged"; then
    fail "staged build unavailable; next sync will rebuild"
  fi
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
  rm -rf "$STAGED_DIR"
  remove_legacy_staged
  log "Installed $commit to $APP_PATH (previous app kept at $backup)."
  notify "Orca updated" "Fork build $commit installed."
  open -a "$APP_PATH" || true
}

# Why: `pnpm test --reporter=json` is parsed by pnpm itself, so call vitest the
# way the repo's test script does. The default reporter is kept alongside JSON
# because unhandled errors only appear in its console summary.
run_unit_tests() {
  local report="$1"; shift
  local console_log="${report%.json}.log"
  # Why: ORCA_BALANCE_UNIT_SHARDS changes which tests run, so both runs must agree on it.
  NO_COLOR=1 node config/scripts/ensure-native-runtime.mjs --runtime=node >"$console_log" 2>&1 \
    && env -u ORCA_BALANCE_UNIT_SHARDS -u FORCE_COLOR NO_COLOR=1 pnpm exec vitest run --config config/vitest.config.ts \
      --reporter=json --reporter=default --outputFile.json="$report" "$@" >>"$console_log" 2>&1
}

# Why: the upstream release itself fails some tests on this machine (CI-only
# fixtures, local toolchain differences), so the gate is "the fork adds no
# failures the same release does not already have", not "everything passes".
# The baseline is reused only while every input that can change its outcome
# (release and its commit, lockfile, Node, macOS, CPU, checkout root) is identical.
upstream_baseline_key() {
  printf '%s|%s|%s|%s|%s|%s|%s' "$latest" "$(git rev-parse "$latest_ref^{commit}")" "$(git rev-parse "$latest_ref:pnpm-lock.yaml")" \
    "$(node --version)" "$(sw_vers -productVersion)" "$(uname -m)" "$UPSTREAM_ROOT" | shasum -a 256 | cut -c1-16
}

upstream_report() {
  local key report confirm
  key="$(upstream_baseline_key)"
  report="$STATE_DIR/upstream-tests-$key.json"
  confirm="$STATE_DIR/upstream-confirm-$key.json"
  if [[ -s "$report" && -s "${report%.json}.log" && -s "$confirm" && -s "${confirm%.json}.log" ]]; then
    log "Reusing upstream $latest test baseline ($key)."
  else
    rm -f "$STATE_DIR"/upstream-tests-*.json "$STATE_DIR"/upstream-tests-*.log \
      "$STATE_DIR"/upstream-confirm-*.json "$STATE_DIR"/upstream-confirm-*.log
    log "Running upstream $latest test suite for the failure baseline ($key)."
    git worktree remove --force "$UPSTREAM_WORKTREE" 2>/dev/null || true
    git worktree add --force --detach "$UPSTREAM_WORKTREE" "$latest_ref" >/dev/null
    (
      cd "$UPSTREAM_WORKTREE" && pnpm install --frozen-lockfile >/dev/null 2>&1 || exit 1
      run_unit_tests "$report" || true
      [[ -s "$report" ]] || exit 1
      # Re-run upstream's failing files so only reproducible failures enter the baseline.
      local failing=()
      while IFS= read -r file; do failing+=("$file"); done < <(node "$COMPARE" --files "$report" "$UPSTREAM_ROOT")
      if (( ${#failing[@]} > 0 )); then
        log "Confirming ${#failing[@]} failing upstream file(s)."
        run_unit_tests "$confirm" "${failing[@]}" || true
      else
        # Nothing re-runnable: confirm nothing, so unattributed upstream errors never mask fork ones.
        echo '{"testResults":[]}' > "$confirm"
        echo 'no upstream failures to confirm' > "${confirm%.json}.log"
      fi
    ) || true
    git worktree remove --force "$UPSTREAM_WORKTREE" 2>/dev/null || true
    [[ -s "$report" && -s "${report%.json}.log" && -s "$confirm" && -s "${confirm%.json}.log" ]] || return 1
  fi
  echo "$report,$confirm"
}

verify() {
  node --test fork-sync/*.test.mjs >&2 || return 1
  # Why: build:mac packages x64 and arm64, which needs both native variants installed.
  pnpm run install:release >&2 || return 1
  # Why: build:mac bundles the mobile web client, which resolves React Native from mobile/'s own install.
  (cd mobile && pnpm install --frozen-lockfile) >&2 || return 1
  pnpm run tc >&2 || return 1
  local baseline
  local fork_report="$FORK_REPORT" retry_report="$RETRY_REPORT"
  baseline="$(upstream_report)" || { log "Could not produce the upstream test report."; return 1; }
  rm -f "$fork_report" "$retry_report" "${fork_report%.json}.log" "${retry_report%.json}.log"
  run_unit_tests "$fork_report" || true
  [[ -s "$fork_report" ]] || { log "Fork test run produced no report."; return 1; }
  if node "$COMPARE" "$baseline" "$UPSTREAM_ROOT" "$fork_report" "$REPO" > "$INTRODUCED_FILE"; then
    return 0
  fi
  # Re-run only the affected files once so a flaky test cannot block the sync.
  # Unhandled errors with no test file cannot be retried and fail the gate.
  local files=()
  while IFS= read -r file; do files+=("$file"); done < <(grep -v '^(unhandled error without a test file)' "$INTRODUCED_FILE" | sed 's/ > .*//' | sort -u)
  if (( ${#files[@]} > 0 )) && ! grep -q '^(unhandled error without a test file)' "$INTRODUCED_FILE"; then
    log "Re-running ${#files[@]} file(s) with fork-only failures."
    run_unit_tests "$retry_report" "${files[@]}" || true
    if [[ -s "$retry_report" ]] \
      && node "$COMPARE" "$baseline" "$UPSTREAM_ROOT" "$retry_report" "$REPO" "${files[@]}" > "$INTRODUCED_FILE"; then
      return 0
    fi
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
git fetch --quiet origin || fail "could not fetch origin"
# Why: upstream releases live only in their own namespace, so a fork tag can
# neither pose as a release nor block the fetch by sharing a release's name.
git fetch --quiet --prune --no-tags upstream '+refs/tags/*:refs/upstream-tags/*' || fail "could not fetch upstream tags into refs/upstream-tags"
# This clone belongs to the job alone, so it always restarts from the pushed branch.
git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
git reset --quiet --hard "origin/$BRANCH"
git clean -fdq

latest="$(gh release view --repo "$UPSTREAM_REPO" --json tagName,isPrerelease --jq 'select(.isPrerelease == false) | .tagName')"
[[ "$latest" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "unexpected latest release tag '$latest'"
log "Latest stable upstream release: $latest"
latest_ref="refs/upstream-tags/$latest"
git rev-parse --quiet --verify "$latest_ref^{commit}" >/dev/null || fail "upstream release $latest is missing from refs/upstream-tags"

pre_merge="$(git rev-parse HEAD)"
merged_new_release=false
if git merge-base --is-ancestor "$latest_ref" HEAD; then
  log "$latest is already merged into $BRANCH."
else
  merged_new_release=true
  if ! git merge --no-ff --no-edit -m "chore(fork): merge upstream $latest" "$latest_ref"; then
    log "Merge has conflicts: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"
    auto_resolved="$(node "$RESOLVE_UNTOUCHED" "$REPO" "$pre_merge")" \
      || { git merge --abort; fail "automatic pre-resolution of untouched conflicts failed"; }
    if [[ -n "$auto_resolved" ]]; then
      log "Took upstream $latest for conflicts in files the fork never modified: $(tr '\n' ' ' <<<"$auto_resolved")"
    fi
    if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
      log "Conflicts left for Claude: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"
      run_claude "Resolve every merge conflict from merging upstream release $latest into $BRANCH. Run \`git diff --name-only --diff-filter=U\` to list them." \
        || { git merge --abort; fail "Claude conflict resolution session failed"; }
    else
      log "Every conflict was in a file the fork never modified; skipping the Claude session."
    fi
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
prepare_build_output
ORCA_SELF_MANAGED_UPDATES=1 ORCA_MAC_LOCAL_APP_ONLY=1 CSC_NAME="$SIGN_IDENTITY" pnpm run build:mac >&2 || fail "build failed for $current"
case "$(uname -m)" in
  arm64) built_app="dist/mac-arm64/Orca.app" ;;
  *) built_app="dist/mac/Orca.app" ;;
esac
[[ -d "$built_app" ]] || fail "build produced no Orca.app at $built_app"
codesign --verify --deep --strict "$built_app" || fail "built app signature invalid"

git fetch --quiet --prune origin || fail "could not fetch origin before pushing $current"
if git merge-base --is-ancestor HEAD "origin/$BRANCH"; then
  log "origin/$BRANCH already contains $current; nothing to push."
else
  git push --quiet origin "$BRANCH" || fail "push of $BRANCH failed"
  log "Pushed $BRANCH ($current) to origin."
fi

stage_build "$built_app"
staged="$STAGED_DIR/Orca.app"

kill "$caffeinate_pid" 2>/dev/null || true
wait_and_install "$staged" "$current"
