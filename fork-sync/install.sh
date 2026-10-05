#!/bin/bash
# Installs the weekly Orca fork sync as a user LaunchAgent (Sundays 03:00;
# launchd runs a missed slot on next wake). Re-run after editing the sync script.
set -euo pipefail

LABEL="com.divy2000.orca-fork-sync"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$HOME/.orca-fork-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$STATE_DIR/bin" "$HOME/Library/Logs/orca-fork-sync" "$HOME/Library/LaunchAgents"
install -m 755 "$SRC_DIR/orca-fork-sync.sh" "$STATE_DIR/bin/orca-fork-sync.sh"
install -m 644 "$SRC_DIR/compare-test-failures.mjs" "$STATE_DIR/bin/compare-test-failures.mjs"
install -m 644 "$SRC_DIR/resolve-untouched-conflicts.mjs" "$STATE_DIR/bin/resolve-untouched-conflicts.mjs"
# Why: Orca's build scripts call `pnpm` directly; pin the repo's pnpm version.
cat > "$STATE_DIR/bin/pnpm" <<'SHIM'
#!/bin/bash
exec npx -y pnpm@12.0.0 "$@"
SHIM
chmod 755 "$STATE_DIR/bin/pnpm"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$STATE_DIR/bin/orca-fork-sync.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/orca-fork-sync/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/orca-fork-sync/launchd.err.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLISTEOF
plutil -lint "$PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL. Run now with: launchctl kickstart gui/$(id -u)/$LABEL"
