#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

XCODE_APP="${XCODE_APP:-/Applications/Xcode.app}"

if [[ -d "$XCODE_APP" ]]; then
  export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
fi

if [[ ! -d ios || ! -d ios/Focusmap.xcworkspace ]]; then
  echo "ios/ がないため、Expo の iOS ネイティブプロジェクトを生成します。"
  npx expo prebuild --platform ios --no-install
  npx pod-install ios
fi

if [[ ! -d ios/Focusmap.xcworkspace ]]; then
  echo "ios/Focusmap.xcworkspace を作成できませんでした。" >&2
  exit 2
fi

open ios/Focusmap.xcworkspace

cat <<'MESSAGE'

Xcodeで次を確認してください。

1. 左のProject Navigatorで Focusmap を選ぶ
2. TARGETS > Focusmap を選ぶ
3. Signing & Capabilities を開く
4. Add Account... から無料Apple IDを追加
5. Team に自分の Personal Team を選択

証明書が作られたか確認:
  security find-identity -v -p codesigning

実機インストール:
  npm run ios:install:free
MESSAGE
