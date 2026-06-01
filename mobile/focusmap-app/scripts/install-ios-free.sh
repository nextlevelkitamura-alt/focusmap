#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

XCODE_APP="${XCODE_APP:-/Applications/Xcode.app}"

if [[ -d "$XCODE_APP" ]]; then
  export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
fi

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

if xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  :
else
  cat <<'MESSAGE'
Xcodeの初回セットアップが未完了です。

一度だけ次を実行して、ライセンス承認と追加コンポーネントの準備を済ませてください。

  sudo xcodebuild -license accept
  sudo xcodebuild -runFirstLaunch

終わったら、もう一度このスクリプトを実行してください。
MESSAGE
  exit 3
fi

echo "Focusmap iOS appを接続中のiPhoneへインストールします。"
echo "XcodeにApple IDを入れていない場合は、Xcode > Settings > Accounts で無料Apple IDを追加してください。"
echo
echo "Xcode: $(xcodebuild -version | tr '\n' ' ')"
echo "接続先: ${EXPO_PUBLIC_FOCUSMAP_URL:-https://focusmap-official.com/dashboard}"
echo

npm run typecheck
npx expo-doctor

npx expo run:ios --device --configuration Release
