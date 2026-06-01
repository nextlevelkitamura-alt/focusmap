#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

XCODE_APP="${XCODE_APP:-/Applications/Xcode.app}"

section() {
  printf "\n== %s ==\n" "$1"
}

fail_with_next_step() {
  printf "\n停止: %s\n" "$1" >&2
  if [[ $# -gt 1 ]]; then
    printf "\n次に実行:\n%s\n" "$2" >&2
  fi
  exit 2
}

section "Xcode"
if [[ ! -d "$XCODE_APP" ]]; then
  fail_with_next_step \
    "Xcode.app がまだありません。" \
    "App StoreでXcodeのダウンロードを完了してから、もう一度 npm run ios:morning を実行してください。"
fi

export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
printf "Xcode path: %s\n" "$XCODE_APP"
xcodebuild -version

section "First launch"
if xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  printf "Xcode first-launch setup is already complete.\n"
else
  printf "Xcode first-launch setup is not complete. Running setup now.\n"
  printf "macOS password may be required by sudo.\n"
  sudo xcodebuild -license accept
  sudo xcodebuild -runFirstLaunch
fi

section "Project checks"
npm run typecheck
npx expo-doctor

section "iPhone"
if command -v xcrun >/dev/null 2>&1; then
  xcrun devicectl list devices || true
fi

section "Install"
./scripts/install-ios-free.sh
