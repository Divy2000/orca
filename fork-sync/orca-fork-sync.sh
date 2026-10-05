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
# Test suites run from one of these, chosen per run by choose_test_run_dir.
INTERNAL_TEST_DIR="$STATE_DIR/test-run"
SCRATCH_TEST_DIR="$RUN_DIR/test-run"
MIN_INTERNAL_TEST_FREE_KB=$((6 * 1024 * 1024))
TEST_RUN_DIR=""
UPSTREAM_WORKTREE=""
UPSTREAM_ROOT=""
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

# Prints a watchdog limit given in whole minutes through the environment, in seconds.
minutes_setting() {
  local name="$1" default="$2" value
  eval "value=\${$name:-$default}"
  [[ "$value" =~ ^[0-9]+$ ]] || fail "$name must be a whole number of minutes, got '$value'"
  echo $(( value * 60 ))
}

load_average_5m() { sysctl -n vm.loadavg | awk '{ print $3 }'; }
cpu_count() { sysctl -n hw.logicalcpu; }

# Prints the given pids followed by all of their descendants.
descendant_pids() {
  local table queue="$*" next pid all=""
  table="$(ps -A -o pid= -o ppid=)"
  while [[ -n "$queue" ]]; do
    next=""
    for pid in $queue; do
      all="$all $pid"
      next="$next $(awk -v parent="$pid" '$2 == parent { print $1 }' <<<"$table")"
    done
    queue="$(echo $next)"
  done
  echo $all
}

# Why: a step runs in its own process group, but a worker spawned detached
# leaves it; walking the process tree as well leaves no survivor.
kill_step_tree() {
  local root="$1" pids
  pids="$(descendant_pids "$root")"
  kill -TERM -- "-$root" $pids 2>/dev/null || true
  sleep "$KILL_GRACE_SECONDS"
  pids="$(descendant_pids $pids)"
  kill -KILL -- "-$root" $pids 2>/dev/null || true
}

# Runs a long step in its own process group with its output appended to <log>.
# The step and everything it started are killed when <log> stops growing for
# <stall> seconds (0 disables this) or the step outlives <budget> seconds, and
# the job then fails naming the step and the machine load. Otherwise returns
# the step's own exit status.
run_step() {
  local name="$1" budget="$2" stall="$3" log_file="$4"; shift 4
  local pid started now size last_size=-1 last_growth reason="" status=0
  touch "$log_file"
  set -m
  ( "$@" ) </dev/null >>"$log_file" 2>&1 &
  pid=$!
  set +m
  CURRENT_STEP_PID="$pid"
  started="$(date +%s)"
  last_growth="$started"
  while kill -0 "$pid" 2>/dev/null; do
    sleep "$WATCHDOG_POLL_SECONDS"
    now="$(date +%s)"
    size="$(wc -c <"$log_file")"
    if (( size != last_size )); then
      last_size="$size"
      last_growth="$now"
    fi
    if (( stall > 0 && now - last_growth >= stall )); then
      reason="stalled (no output for $(( now - last_growth ))s)"
    elif (( now - started >= budget )); then
      reason="exceeded its budget of ${budget}s"
    fi
    if [[ -n "$reason" ]]; then
      kill_step_tree "$pid"
      wait "$pid" 2>/dev/null || true
      CURRENT_STEP_PID=""
      log "Last output of $name:"
      tail -n 40 "$log_file" >&2
      fail "$name $reason; machine load was $(load_average_5m) on $(cpu_count) cores"
    fi
  done
  wait "$pid" || status=$?
  CURRENT_STEP_PID=""
  return "$status"
}

# Runs a watched step whose output belongs in the job log: it streams to a
# step log the watchdog can measure and is copied into the job log at the end.
step_log_path() {
  printf '%s/step-%s.log' "$RUN_DIR" "$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '-')"
}

run_logged_step() {
  local name="$1" budget="$2" stall="$3"; shift 3
  local step_log status=0
  step_log="$(step_log_path "$name")"
  : >"$step_log"
  log "$name started; live output in $step_log"
  run_step "$name" "$budget" "$stall" "$step_log" "$@" || status=$?
  cat "$step_log" >&2
  return "$status"
}

# Why: steps run outside the job's process group, so launchd stopping the job
# no longer reaches them; the exit handler stops the running one instead.
stop_current_step() {
  if [[ -n "$CURRENT_STEP_PID" ]]; then
    log "Stopping the running step (pid $CURRENT_STEP_PID) before exiting."
    kill_step_tree "$CURRENT_STEP_PID"
    CURRENT_STEP_PID=""
  fi
}

# Prints a reduced vitest worker count while the machine is overloaded, or
# nothing to keep vitest's default on a machine with spare cores.
vitest_workers() {
  awk -v load="$(load_average_5m)" -v cores="$(cpu_count)" 'BEGIN {
    if (load <= cores) exit
    workers = cores - int(load - cores)
    cap = int(cores / 2)
    if (workers > cap) workers = cap
    if (workers < 1) workers = 1
    print workers
  }'
}

# Why: worker count changes timing-sensitive outcomes, so the upstream and fork
# runs of one sync use the same count, chosen once.
choose_vitest_workers() {
  if [[ "$VITEST_WORKERS_CHOSEN" == true ]]; then
    return 0
  fi
  VITEST_WORKERS="$(vitest_workers)"
  VITEST_WORKERS_CHOSEN=true
  log "Vitest workers for this sync: ${VITEST_WORKERS:-vitest default} (5-minute load $(load_average_5m) on $(cpu_count) cores)."
}

exit_if_machine_busy() {
  local load cores
  load="$(load_average_5m)"
  cores="$(cpu_count)"
  if awk -v load="$load" -v cores="$cores" 'BEGIN { exit !(load > 2 * cores) }'; then
    log "SKIPPED: machine busy (5-minute load $load on $cores cores); sync not started. The next scheduled or manual run tries again."
    notify "Orca fork sync" "machine busy, sync skipped"
    exit 0
  fi
}

load_watchdog_settings() {
  STALL_SECONDS="$(minutes_setting ORCA_SYNC_STALL_MINUTES 30)"
  TEST_BUDGET_SECONDS="$(minutes_setting ORCA_SYNC_TEST_BUDGET_MINUTES 120)"
  TYPECHECK_BUDGET_SECONDS="$(minutes_setting ORCA_SYNC_TYPECHECK_BUDGET_MINUTES 90)"
  INSTALL_BUDGET_SECONDS="$(minutes_setting ORCA_SYNC_INSTALL_BUDGET_MINUTES 30)"
  BUILD_BUDGET_SECONDS="$(minutes_setting ORCA_SYNC_BUILD_BUDGET_MINUTES 90)"
  CLAUDE_BUDGET_SECONDS="$(minutes_setting ORCA_SYNC_CLAUDE_BUDGET_MINUTES 60)"
}

# Prints "<budget-seconds> <stall-seconds>" for a kind of step. Why no stall
# limit for typecheck, build and Claude: tsc (also inside build:mac) and
# `claude -p` stay silent for long stretches while healthy.
step_limits() {
  case "$1" in
    tests) echo "$TEST_BUDGET_SECONDS $STALL_SECONDS" ;;
    install) echo "$INSTALL_BUDGET_SECONDS $STALL_SECONDS" ;;
    typecheck) echo "$TYPECHECK_BUDGET_SECONDS 0" ;;
    build) echo "$BUILD_BUDGET_SECONDS 0" ;;
    claude) echo "$CLAUDE_BUDGET_SECONDS 0" ;;
    *) fail "unknown kind of step '$1'" ;;
  esac
}

load_watchdog_settings
# Why: poll plus kill grace stays under launchd's 20s stop timeout.
WATCHDOG_POLL_SECONDS=10
KILL_GRACE_SECONDS=5
CURRENT_STEP_PID=""
VITEST_WORKERS=""
VITEST_WORKERS_CHOSEN=false
VERIFY_FAILURE=""
TEST_SCOPE=""
RELATED_FORK_SOURCES=""
RELATED_UPSTREAM_SOURCES=""

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
  # Both test-run locations, since an earlier run may have used the other disk;
  # $RUN_DIR/upstream is where earlier versions kept the upstream worktree.
  rm -rf "$INTERNAL_TEST_DIR" "$SCRATCH_TEST_DIR" "$RUN_DIR/upstream" \
    "$FORK_REPORT" "${FORK_REPORT%.json}.log" "$RETRY_REPORT" "${RETRY_REPORT%.json}.log"
  rm -f "$RUN_DIR"/step-*.log
  # Only the link is removed; a real dist/ from a fallback run stays as before.
  if [[ -L "$REPO/dist" ]]; then
    rm -f "$REPO/dist"
  fi
  if [[ "$RUN_DIR" != "$STATE_DIR" ]]; then
    rm -rf "$RUN_DIR/tmp" "$RUN_DIR/build"
    rmdir "$RUN_DIR" 2>/dev/null || true
  fi
  if [[ -d "$REPO/.git" ]]; then
    git -C "$REPO" worktree prune --expire=now
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
free_kb() { df -Pk "$1" | awk 'NR == 2 { print $4 }'; }

# Why: vitest ran about 18x slower from the USB scratch disk than from the
# internal one, so the upstream worktree and vitest's temp dir use the internal
# disk when it has room. cleanup_run_data deletes them with every run.
choose_test_run_dir() {
  local free
  free="$(free_kb "$STATE_DIR")"
  if (( free >= MIN_INTERNAL_TEST_FREE_KB )); then
    TEST_RUN_DIR="$INTERNAL_TEST_DIR"
  else
    TEST_RUN_DIR="$SCRATCH_TEST_DIR"
    log "Internal disk has only $(( free / 1024 / 1024 )) GB free; running tests from $TEST_RUN_DIR instead."
  fi
  mkdir -p "$TEST_RUN_DIR/tmp"
  UPSTREAM_WORKTREE="$TEST_RUN_DIR/upstream"
  # Why: Node reports the physical cwd, so vitest names upstream test files by the
  # real worktree path, not a symlinked one; failure ids are relative to it.
  UPSTREAM_ROOT="$(cd "$TEST_RUN_DIR" && pwd -P)/upstream"
  log "Test suites run from $TEST_RUN_DIR."
}

prepare_run() {
  # Removes leftovers of a run that was killed before its trap could clean up.
  cleanup_run_data
  mkdir -p "$RUN_DIR"
  if [[ "$RUN_DIR" != "$STATE_DIR" ]]; then
    mkdir -p "$RUN_DIR/tmp"
    export TMPDIR="$RUN_DIR/tmp"
  fi
  log "Run data directory: $RUN_DIR"
  exit_if_machine_busy
  # Why: measured before installs, typecheck and builds add load of our own.
  choose_vitest_workers
  choose_test_run_dir
}

on_exit() {
  stop_current_step
  cleanup_run_data || log "Could not fully clean run data in $RUN_DIR."
  [[ "$(cat "$LOCK_FILE" 2>/dev/null)" == "$$" ]] && rm -f "$LOCK_FILE"
}
trap on_exit EXIT
trap 'exit 143' TERM HUP INT
prepare_run

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
  run_logged_step "Claude session" $(step_limits claude) claude_session "$prompt" || return 1
}

claude_session() {
  cd "$REPO" && claude -p --dangerously-skip-permissions --max-turns "$CLAUDE_MAX_TURNS" "$1"
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
  : >"$console_log"
  run_step "unit tests ($(basename "${report%.json}"))" $(step_limits tests) \
    "$console_log" unit_test_commands "$report" "$@"
}

# Runs vitest on test-file filters, or with --related first on source files
# whose dependent tests should run.
unit_test_commands() {
  local report="$1"; shift
  local mode=(run)
  if [[ "${1:-}" == --related ]]; then
    shift
    mode=(related --run)
  fi
  local workers=()
  if [[ -n "$VITEST_WORKERS" ]]; then
    workers=(--maxWorkers="$VITEST_WORKERS")
  fi
  local TMPDIR="$TEST_RUN_DIR/tmp"
  export TMPDIR
  # Why: ORCA_BALANCE_UNIT_SHARDS changes which tests run, so both runs must agree on it.
  NO_COLOR=1 node config/scripts/ensure-native-runtime.mjs --runtime=node \
    && env -u ORCA_BALANCE_UNIT_SHARDS -u FORCE_COLOR NO_COLOR=1 pnpm exec vitest "${mode[@]}" --config config/vitest.config.ts \
      --reporter=json --reporter=default --outputFile.json="$report" ${workers[@]+"${workers[@]}"} "$@"
}

# Why: the upstream release itself fails some tests on this machine (CI-only
# fixtures, local toolchain differences), so the gate is "the fork adds no
# failures the same release does not already have", not "everything passes".
# The baseline is reused only while every input that can change its outcome
# (release and its commit, lockfile, Node, macOS, CPU, checkout root, vitest
# worker count) is identical.
# Bump the format whenever the way a baseline is built changes, so
# baselines cached by the old way are never reused. 2: mobile/ is installed first.
upstream_baseline_key() {
  local format=2
  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s' "$latest" "$(git rev-parse "$latest_ref^{commit}")" "$(git rev-parse "$latest_ref:pnpm-lock.yaml")" \
    "$(node --version)" "$(sw_vers -productVersion)" "$(uname -m)" "$UPSTREAM_ROOT" "workers=${VITEST_WORKERS:-default}" \
    "tests=$(test_scope_key)" "baseline-format=$format" | shasum -a 256 | cut -c1-16
}

test_scope_key() {
  if [[ "$TEST_SCOPE" == related ]]; then
    printf 'related:%s' "$(printf '%s' "$RELATED_UPSTREAM_SOURCES" | shasum -a 256 | cut -c1-16)"
  else
    printf 'full'
  fi
}

count_lines() {
  if [[ -z "$1" ]]; then
    echo 0
  else
    printf '%s\n' "$1" | wc -l | tr -d ' '
  fi
}

# Prints the source files the fork changed relative to the upstream release
# that still exist in the fork, one per line. fork-sync/ is this job's own code,
# not part of the app's test suite.
fork_changed_sources() {
  local changed
  changed="$(git diff --name-only --no-renames --diff-filter=d "$latest_ref" --)" || return 1
  # Untracked files from a repair session are part of what gets committed.
  changed="$changed"$'\n'"$(git ls-files --others --exclude-standard)"
  printf '%s\n' "$changed" | source_files
}

# Filters stdin to app source files outside fork-sync/.
source_files() {
  grep -v '^fork-sync/' | grep -E '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$' || true
}

# Prints why related tests cannot stand in for the full suites, or nothing.
# Prints the repo paths the vitest configs at HEAD load: quoted relative paths
# ("./scripts/x.mjs", resolved against the config's directory) and quoted
# repo-root "config/..." paths. A path without a source extension is also listed
# with each one, since an import may omit it (even after a dot: "./vitest.config").
vitest_config_inputs() {
  local configs config
  configs="$(git ls-tree -r --name-only HEAD -- config)" || return 1
  printf '%s\n' "$configs" | grep -E '^config/vitest[^/]*\.config\.[^/]+$' | while IFS= read -r config; do
    git show "HEAD:$config" | node -e '
      const { posix } = require("node:path")
      const source = require("node:fs").readFileSync(0, "utf8")
      const quoted = /[\x22\x27`]((?:\.\.?|config)\/[^\x22\x27`\s]+)[\x22\x27`]/g
      const extensions = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]
      for (const [, spec] of source.matchAll(quoted)) {
        const path = spec.startsWith("config/")
          ? posix.normalize(spec)
          : posix.join(posix.dirname(process.argv[1]), spec)
        console.log(path)
        if (!extensions.includes(posix.extname(path))) {
          for (const ext of extensions) console.log(path + ext)
        }
      }
    ' "$config"
  done | sort -u
}

# Why: vitest related follows the current import graph, so it misses tests of
# deleted or renamed-away modules, and inputs every test depends on
# (dependencies, TypeScript and vitest/vite config) make every test related.
full_suite_reason() {
  local deleted changed global loaded
  deleted="$(git diff --name-only --no-renames --diff-filter=D "$latest_ref" --)" || return 1
  deleted="$(printf '%s\n' "$deleted" | source_files)"
  if [[ -n "$deleted" ]]; then
    printf 'the fork deleted or renamed away %s source file(s): %s' \
      "$(count_lines "$deleted")" "$(echo $deleted)"
    return 0
  fi
  changed="$(git diff --name-only --no-renames "$latest_ref" --)" || return 1
  global="$(printf '%s\n' "$changed" | grep -v '^fork-sync/' | grep -E \
    '^(pnpm-lock\.yaml|package\.json|mobile/package\.json|mobile/pnpm-lock\.yaml|config/vitest.*)$|(^|/)(tsconfig[^/]*\.json|\.npmrc|pnpm-workspace\.yaml|vitest[^/]*\.config\.[cm]?[jt]s)$' \
    || true)"
  # Why: setup files, reporters and helpers the vitest configs load affect every
  # test, but `vitest related` only follows imports from test files.
  loaded="$(vitest_config_inputs)" || return 1
  if [[ -n "$loaded" ]]; then
    global="$(printf '%s\n%s\n' "$global" "$(printf '%s\n' "$changed" | grep -Fx -f <(printf '%s\n' "$loaded") || true)" \
      | grep -v '^$' | sort -u || true)"
  fi
  if [[ -n "$global" ]]; then
    printf 'the fork changed global test inputs: %s' "$(echo $global)"
  fi
}

# Prints the paths read from stdin that exist in the upstream release.
paths_in_upstream() {
  local path
  while IFS= read -r path; do
    if [[ -n "$path" ]] && git cat-file -e "$latest_ref:$path" 2>/dev/null; then
      printf '%s\n' "$path"
    fi
  done
}

# Why: the full suites took hours on a busy machine, so the gate runs only the
# tests related to what the fork changed, in both checkouts, unless
# ORCA_SYNC_FULL_TEST_SUITE=1. Files that exist only in the fork cannot go to
# the upstream run, so fork-only tests have no baseline and must pass outright.
select_test_scope() {
  if [[ "${ORCA_SYNC_FULL_TEST_SUITE:-}" == 1 ]]; then
    TEST_SCOPE=full
    RELATED_FORK_SOURCES=""
    RELATED_UPSTREAM_SOURCES=""
    log "ORCA_SYNC_FULL_TEST_SUITE=1: running the full unit test suites."
    return 0
  fi
  local reason
  reason="$(full_suite_reason)" || return 1
  if [[ -n "$reason" ]]; then
    TEST_SCOPE=full
    RELATED_FORK_SOURCES=""
    RELATED_UPSTREAM_SOURCES=""
    log "Running the full unit test suites: $reason."
    return 0
  fi
  TEST_SCOPE=related
  RELATED_FORK_SOURCES="$(fork_changed_sources)" || return 1
  RELATED_UPSTREAM_SOURCES="$(paths_in_upstream <<<"$RELATED_FORK_SOURCES")" || return 1
  log "Related tests: $(count_lines "$RELATED_FORK_SOURCES") changed source file(s) selected for the fork run; $(count_lines "$RELATED_UPSTREAM_SOURCES") of them exist in $latest."
}

nothing_to_test() {
  if [[ "$TEST_SCOPE" == related && -z "$RELATED_FORK_SOURCES" ]]; then
    log "No fork source changes relative to $latest; no related unit tests to run."
    return 0
  fi
  return 1
}

report_test_files() {
  node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).testResults.length)' "$1"
}

# Runs the gate's test scope for one checkout: the full suite, or the tests
# related to <sources> (newline-separated). Returns run_unit_tests' status.
run_scoped_tests() {
  local label="$1" report="$2" sources="$3" status=0 path
  local paths=()
  if [[ "$TEST_SCOPE" == related ]]; then
    while IFS= read -r path; do
      if [[ -n "$path" ]]; then
        paths+=("$path")
      fi
    done <<<"$sources"
    if (( ${#paths[@]} == 0 )); then
      echo '{"testResults":[]}' > "$report"
      echo 'no related source files; no tests run' > "${report%.json}.log"
      log "$label: no related source files; no tests run."
      return 0
    fi
    run_unit_tests "$report" --related "${paths[@]}" || status=$?
  else
    run_unit_tests "$report" || status=$?
  fi
  if [[ -s "$report" ]]; then
    log "$label: $(report_test_files "$report") test file(s) ran."
  fi
  return "$status"
}

# Sets UPSTREAM_BASELINE. Why no subshell: a watchdog trip inside it must end the job.
upstream_report() {
  local key report confirm file
  local failing=()
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
    # Why: callers test this with ||, which disables errexit; a silent failure here
    # would leave cwd in $REPO and use the fork itself as the upstream baseline.
    if ! git worktree add --force --detach "$UPSTREAM_WORKTREE" "$latest_ref" >/dev/null \
      || ! cd "$UPSTREAM_WORKTREE"; then
      log "Could not prepare the upstream worktree at $UPSTREAM_WORKTREE."
      cd "$REPO"
      return 1
    fi
    # Why: like the fork's verify, mobile/ needs its own install; tests that import
    # mobile/ files cannot even load without it.
    if ! run_step "upstream pnpm install" $(step_limits install) \
      "$RUN_DIR/step-upstream-install.log" pnpm install --frozen-lockfile; then
      log "Upstream pnpm install failed:"
      tail -n 40 "$RUN_DIR/step-upstream-install.log" >&2 || true
    elif ! run_step "upstream mobile pnpm install" $(step_limits install) \
      "$RUN_DIR/step-upstream-mobile-install.log" mobile_install; then
      log "Upstream mobile pnpm install failed:"
      tail -n 40 "$RUN_DIR/step-upstream-mobile-install.log" >&2 || true
    else
      run_scoped_tests "Upstream $latest tests" "$report" "$RELATED_UPSTREAM_SOURCES" || true
    fi
    if [[ -s "$report" ]]; then
      # Re-run upstream's failing files so only reproducible failures enter the baseline.
      while IFS= read -r file; do failing+=("$file"); done < <(node "$COMPARE" --files "$report" "$UPSTREAM_ROOT")
      if (( ${#failing[@]} > 0 )); then
        log "Confirming ${#failing[@]} failing upstream file(s)."
        run_unit_tests "$confirm" "${failing[@]}" || true
      else
        # Nothing re-runnable: confirm nothing, so unattributed upstream errors never mask fork ones.
        echo '{"testResults":[]}' > "$confirm"
        echo 'no upstream failures to confirm' > "${confirm%.json}.log"
      fi
    fi
    cd "$REPO"
    git worktree remove --force "$UPSTREAM_WORKTREE" 2>/dev/null || true
    [[ -s "$report" && -s "${report%.json}.log" && -s "$confirm" && -s "${confirm%.json}.log" ]] || return 1
  fi
  UPSTREAM_BASELINE="$report,$confirm"
}

mobile_install() {
  cd mobile && pnpm install --frozen-lockfile
}

# Prints the pnpm frozen-lockfile error a logged step hit, if any. The first four
# were reproduced with pnpm 12: a manifest change, an "overrides" change, a
# deleted lockfile, and a conflict marker left in the lockfile; the fifth is a
# packageManager pin the lockfile does not match.
lockfile_mismatch() {
  grep -oE 'ERR_PNPM_(FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE|OUTDATED_LOCKFILE|LOCKFILE_CONFIG_MISMATCH|NO_LOCKFILE|BROKEN_LOCKFILE)' \
    "$(step_log_path "$1")" 2>/dev/null | head -n 1 || true
}

# Runs a fork-side install. Why a lockfile error is repairable: a merge can
# leave package manifests and their pnpm-lock.yaml out of sync, which a repair
# session can fix; any other install failure says nothing about the fork's code.
fork_install() {
  local name="$1" code; shift
  if run_logged_step "$name" $(step_limits install) "$@"; then
    return 0
  fi
  code="$(lockfile_mismatch "$name")"
  if [[ -z "$code" ]]; then
    fail "$name failed"
  fi
  VERIFY_FAILURE="\`$name\` fails with $code: the merge left package manifests and their pnpm-lock.yaml out of sync"
  log "$name failed with $code; a repair session can bring the lockfile back in sync."
  return 1
}

# Returns 1 only for failures a Claude repair session can fix, described in
# VERIFY_FAILURE: a lockfile out of sync after the merge, a failing typecheck,
# or test failures and unhandled errors the upstream release does not have.
# Why fail directly otherwise: a broken install or a missing test report says
# nothing about the fork's code, so a repair session would only guess.
verify() {
  node --test fork-sync/*.test.mjs >&2 || fail "fork-sync self-tests failed"
  VERIFY_FAILURE=""
  # Why: build:mac packages x64 and arm64, which needs both native variants installed.
  fork_install "pnpm install:release" pnpm run install:release || return 1
  # Why: build:mac bundles the mobile web client, which resolves React Native from mobile/'s own install.
  fork_install "mobile pnpm install" mobile_install || return 1
  if ! run_logged_step "typecheck" $(step_limits typecheck) pnpm run tc; then
    VERIFY_FAILURE="\`pnpm run tc\` fails"
    return 1
  fi
  select_test_scope || fail "could not select the unit tests to run"
  if nothing_to_test; then
    return 0
  fi
  local baseline
  local fork_report="$FORK_REPORT" retry_report="$RETRY_REPORT"
  upstream_report || fail "could not produce the upstream $latest test report"
  baseline="$UPSTREAM_BASELINE"
  rm -f "$fork_report" "$retry_report" "${fork_report%.json}.log" "${retry_report%.json}.log"
  run_scoped_tests "Fork tests" "$fork_report" "$RELATED_FORK_SOURCES" || true
  [[ -s "$fork_report" ]] || fail "the fork test run produced no report"
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
  VERIFY_FAILURE="the fork has test failures or unhandled errors that the plain upstream release does not (listed in $INTRODUCED_FILE)"
  return 1
}

# Why: --no-commit leaves room to correct the result before it is committed, and
# the commit then runs the repo's pre-commit hook like any other commit.
merge_upstream_release() {
  local conflicted=false auto_resolved normalized file
  local changed_by_merge=()
  git merge --no-ff --no-commit -m "chore(fork): merge upstream $latest" "$latest_ref" || conflicted=true
  if [[ "$conflicted" == true ]]; then
    log "Merge has conflicts: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"
    auto_resolved="$(node "$RESOLVE_UNTOUCHED" "$REPO" "$pre_merge")" \
      || { git merge --abort; fail "automatic pre-resolution of untouched conflicts failed"; }
    if [[ -n "$auto_resolved" ]]; then
      log "Took upstream $latest for conflicts in files the fork never modified: $(tr '\n' ' ' <<<"$auto_resolved")"
    fi
  fi
  # Why: when the previous upstream release came from a diverged line, git can
  # merge a file the fork never touched without conflict yet wrongly, e.g. keep
  # the same block twice because both lines added it at different places.
  normalized="$(node "$RESOLVE_UNTOUCHED" --normalize "$REPO" "$pre_merge" "$latest_ref")" \
    || { git merge --abort; fail "restoring upstream versions of files the fork never modified failed"; }
  if [[ -n "$normalized" ]]; then
    log "Restored upstream $latest for files the fork never modified: $(tr '\n' ' ' <<<"$normalized")"
  fi
  if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
    log "Conflicts left for Claude: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"
    run_claude "Resolve every merge conflict from merging upstream release $latest into $BRANCH. Run \`git diff --name-only --diff-filter=U\` to list them." \
      || { git merge --abort; fail "Claude conflict resolution session failed"; }
  elif [[ "$conflicted" == true ]]; then
    log "Every conflict was in a file the fork never modified; skipping the Claude session."
  fi
  if [[ "$conflicted" == true ]]; then
    while IFS= read -r file; do changed_by_merge+=("$file"); done < <(git diff --name-only "$pre_merge" --)
    if [[ -n "$(git diff --name-only --diff-filter=U)" ]] \
      || { (( ${#changed_by_merge[@]} > 0 )) && git grep -nE '^(<<<<<<<|>>>>>>>) ' -- "${changed_by_merge[@]}" >/dev/null; }; then
      git merge --abort
      fail "conflicts remain after Claude session"
    fi
  fi
  git commit --no-edit || { git merge --abort; fail "could not commit the merge of $latest"; }
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
  merge_upstream_release
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
  run_claude "After merging upstream $latest, $VERIFY_FAILURE. Find the root cause and fix it so both upstream and fork behavior are preserved." \
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
run_logged_step "build:mac" $(step_limits build) \
  env ORCA_SELF_MANAGED_UPDATES=1 ORCA_MAC_LOCAL_APP_ONLY=1 CSC_NAME="$SIGN_IDENTITY" pnpm run build:mac \
  || fail "build failed for $current"
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
