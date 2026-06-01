#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

XCODE_APP="${XCODE_APP:-/Applications/Xcode.app}"

section() {
  printf "\n== %s ==\n" "$1"
}

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf "OK   %s\n" "$label"
  else
    printf "NG   %s\n" "$label"
  fi
}

section "Disk"
df -h / /System/Volumes/Data 2>/dev/null || true

section "Xcode"
if [[ -d "$XCODE_APP" ]]; then
  export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
  printf "OK   Xcode app: %s\n" "$XCODE_APP"
else
  printf "NG   Xcode app is missing: %s\n" "$XCODE_APP"
  printf "     Open App Store and install Xcode before running install-ios-free.sh.\n"
fi

if xcodebuild -version >/dev/null 2>&1; then
  xcodebuild -version
else
  printf "NG   xcodebuild is not available from Xcode.app yet.\n"
fi

if xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  printf "OK   Xcode first-launch setup is complete\n"
else
  printf "NG   Xcode first-launch setup is not complete\n"
  printf "     Run: sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch\n"
fi

section "Expo"
check "node_modules" test -d node_modules
npm run typecheck
npx expo-doctor

section "Device"
if command -v xcrun >/dev/null 2>&1 && xcrun devicectl list devices >/tmp/focusmap-ios-devices.txt 2>/dev/null; then
  sed -n '1,80p' /tmp/focusmap-ios-devices.txt
else
  printf "INFO iPhone detection is available after Xcode is installed and selected.\n"
fi

section "Next command"
printf "./scripts/install-ios-free.sh\n"
