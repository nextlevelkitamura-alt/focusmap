#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! xcodebuild -version >/dev/null 2>&1; then
  cat <<'MESSAGE'
Xcode本体が見つかりません。

無料でFocusmapを自分のiPhoneにネイティブアプリとして入れるには、
Mac App StoreからXcode本体を入れてから、次を実行してください。

  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  sudo xcodebuild -license accept

その後、iPhoneをUSB接続して「このコンピュータを信頼」を押し、
もう一度このスクリプトを実行してください。
MESSAGE
  exit 2
fi

echo "Focusmap iOS appを接続中のiPhoneへインストールします。"
echo "XcodeにApple IDを入れていない場合は、Xcode > Settings > Accounts で無料Apple IDを追加してください。"
echo

npx expo run:ios --device --configuration Release
