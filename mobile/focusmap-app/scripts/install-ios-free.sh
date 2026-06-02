#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

XCODE_APP="${XCODE_APP:-/Applications/Xcode.app}"
DEVICE_LIST_FILE="${TMPDIR:-/tmp}/focusmap-ios-devices.txt"
DEVICE_JSON_FILE="${TMPDIR:-/tmp}/focusmap-ios-devices.json"
BUILD_LOG="${TMPDIR:-/tmp}/focusmap-ios-xcodebuild.log"
LAUNCH_LOG="${TMPDIR:-/tmp}/focusmap-ios-launch.log"
DERIVED_DATA_PATH="${FOCUSMAP_IOS_DERIVED_DATA:-ios/build/DeviceDerivedData}"
SCHEME="${FOCUSMAP_IOS_SCHEME:-Focusmap}"
CONFIGURATION="${FOCUSMAP_IOS_CONFIGURATION:-Release}"

section() {
  printf "\n== %s ==\n" "$1"
}

fail() {
  printf "\n停止: %s\n" "$1" >&2
  exit "${2:-2}"
}

detect_ios_device() {
  if ! command -v xcrun >/dev/null 2>&1; then
    return 1
  fi

  if ! xcrun devicectl list devices --json-output "$DEVICE_JSON_FILE" >"$DEVICE_LIST_FILE" 2>/dev/null; then
    return 1
  fi

  node - "$DEVICE_JSON_FILE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const preferred = process.env.FOCUSMAP_IOS_DEVICE || '';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const devices = data.result?.devices || [];
const candidates = devices.filter((device) => {
  const platform = device.hardwareProperties?.platform;
  const state = device.connectionProperties?.tunnelState;
  return platform === 'iOS' && (state === 'available' || state === 'connected');
});

const selected = preferred
  ? candidates.find((device) => {
      const values = [
        device.deviceProperties?.name,
        device.identifier,
        device.hardwareProperties?.udid,
        device.hardwareProperties?.serialNumber,
      ].filter(Boolean);
      return values.includes(preferred);
    })
  : candidates[0];

if (!selected) {
  process.exit(1);
}

process.stdout.write(JSON.stringify({
  name: selected.deviceProperties?.name || selected.identifier,
  identifier: selected.identifier,
  udid: selected.hardwareProperties?.udid || '',
  state: selected.connectionProperties?.tunnelState || '',
  model: selected.hardwareProperties?.marketingName || selected.hardwareProperties?.productType || 'iPhone',
  developerModeStatus: selected.deviceProperties?.developerModeStatus || '',
}));
NODE
}

json_field() {
  node -e '
    const value = JSON.parse(process.argv[1] || "{}");
    const key = process.argv[2];
    process.stdout.write(value[key] ? String(value[key]) : "");
  ' "$1" "$2"
}

app_bundle_id() {
  node -e '
    const config = require("./app.json");
    process.stdout.write(config.expo?.ios?.bundleIdentifier || "");
  '
}

development_team() {
  if [[ -n "${FOCUSMAP_DEVELOPMENT_TEAM:-}" ]]; then
    printf "%s" "$FOCUSMAP_DEVELOPMENT_TEAM"
    return 0
  fi

  xcodebuild \
    -workspace ios/Focusmap.xcworkspace \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "generic/platform=iOS" \
    -showBuildSettings 2>/dev/null \
    | awk -F= '
      /DEVELOPMENT_TEAM/ {
        gsub(/[[:space:]]/, "", $2);
        if ($2 != "") {
          print $2;
          exit
        }
      }
    '
}

latest_app_path() {
  local preferred_path
  preferred_path="$DERIVED_DATA_PATH/Build/Products/${CONFIGURATION}-iphoneos/${SCHEME}.app"
  if [[ -d "$preferred_path" ]]; then
    printf "%s" "$preferred_path"
    return 0
  fi

  find "$DERIVED_DATA_PATH/Build/Products" -path "*-iphoneos/*.app" -print 2>/dev/null | head -n 1
}

trust_message() {
  cat <<'MESSAGE'

アプリはiPhoneへインストール済みです。
初回だけ、iPhone側で開発元を信頼してください。

  設定 > 一般 > VPNとデバイス管理
  > デベロッパAPP
  > 自分のApple ID/開発元
  > 信頼

信頼後はホーム画面のFocusmapを開けます。
MESSAGE
}

try_launch() {
  local device_id="$1"
  local bundle_id="$2"

  rm -f "$LAUNCH_LOG"
  if xcrun devicectl device process launch \
    --device "$device_id" \
    "$bundle_id" \
    --timeout 120 >"$LAUNCH_LOG" 2>&1; then
    cat "$LAUNCH_LOG"
    return 0
  fi

  cat "$LAUNCH_LOG"
  if grep -qiE 'not been explicitly trusted|invalid code signature|Security|Untrusted' "$LAUNCH_LOG"; then
    trust_message
    return 0
  fi

  return 1
}

build_for_device() {
  local destination="$1"
  local team_id="$2"

  rm -f "$BUILD_LOG"
  printf "Build log: %s\n" "$BUILD_LOG"
  printf "初回の実機Releaseビルドは数分以上かかることがあります。\n"

  if ! xcodebuild -quiet \
    -workspace ios/Focusmap.xcworkspace \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "$destination" \
    -destination-timeout 60 \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="$team_id" \
    build >"$BUILD_LOG" 2>&1; then
    tail -160 "$BUILD_LOG" || true
    fail "実機向けXcodeビルドに失敗しました。Build log: $BUILD_LOG" 8
  fi

  printf "OK   Xcode build completed\n"
}

install_app() {
  local device_id="$1"
  local app_path="$2"

  xcrun devicectl device install app \
    --device "$device_id" \
    "$app_path" \
    --timeout 120
}

if ! command -v node >/dev/null 2>&1; then
  fail "node が見つかりません。mobile/focusmap-app の npm install を確認してください。" 1
fi

BUNDLE_ID="$(app_bundle_id)"
if [[ -z "$BUNDLE_ID" ]]; then
  fail "app.json から iOS bundleIdentifier を取得できませんでした。" 1
fi

has_code_signing_identity() {
  security find-identity -v -p codesigning 2>/dev/null \
    | grep -Eq '"(Apple Development|iPhone Developer)[^"]*"'
}

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

section "Project"
if [[ ! -d ios || ! -d ios/Focusmap.xcworkspace ]]; then
  echo "ios/ がないため、Expo の iOS ネイティブプロジェクトを生成します。"
  npx expo prebuild --platform ios --no-install
  npx pod-install ios
fi

if [[ ! -d ios/Focusmap.xcworkspace ]]; then
  fail "ios/Focusmap.xcworkspace を作成できませんでした。" 4
fi

section "iPhone"
DEVICE_INFO="$(detect_ios_device || true)"
if [[ -z "$DEVICE_INFO" ]]; then
  if [[ -f "$DEVICE_LIST_FILE" ]]; then
    sed -n '1,120p' "$DEVICE_LIST_FILE"
  fi
  cat <<'MESSAGE'

iPhoneがインストール可能な状態で見つかりません。

1. iPhoneをUSB接続する
2. iPhone側で「このコンピュータを信頼」を押す
3. 必要ならMac側のFinder/Xcodeでペアリングを完了する
4. もう一度 npm run ios:install:free を実行する

特定の端末名を指定する場合:
  FOCUSMAP_IOS_DEVICE="Naono1" npm run ios:install:free
MESSAGE
  exit 5
fi

DEVICE_NAME="$(json_field "$DEVICE_INFO" name)"
DEVICE_ID="$(json_field "$DEVICE_INFO" identifier)"
DEVICE_UDID="$(json_field "$DEVICE_INFO" udid)"
DEVICE_STATE="$(json_field "$DEVICE_INFO" state)"
DEVICE_MODEL="$(json_field "$DEVICE_INFO" model)"
DEVICE_DEVELOPER_MODE="$(json_field "$DEVICE_INFO" developerModeStatus)"

printf "Install target: %s (%s, %s)\n" "$DEVICE_NAME" "$DEVICE_MODEL" "$DEVICE_STATE"
if [[ "$DEVICE_DEVELOPER_MODE" != "enabled" ]]; then
  printf "WARN Developer Mode is not reported as enabled. iPhone側で有効化が必要な場合があります。\n"
fi

section "Code Signing"
if has_code_signing_identity; then
  printf "OK   Apple Development signing identity is available\n"
else
  cat <<'MESSAGE'
Apple Developmentのコード署名証明書がまだありません。

無料Apple IDルートでは、Xcodeで一度だけPersonal Teamを選ぶ必要があります。

1. npm run ios:signing
2. Xcode > Signing & Capabilities
3. Add Account... から無料Apple IDを追加
4. Team に自分の Personal Team を選択
5. もう一度 npm run ios:install:free を実行
MESSAGE
  exit 6
fi

TEAM_ID="$(development_team || true)"
if [[ -z "$TEAM_ID" ]]; then
  cat <<'MESSAGE'
XcodeプロジェクトにPersonal Teamがまだ設定されていません。

無料Apple IDルートでは、Xcodeで一度だけTeamを選ぶ必要があります。

1. npm run ios:signing
2. Xcode > Signing & Capabilities
3. Team に自分の Personal Team を選択
4. もう一度 npm run ios:install:free を実行
MESSAGE
  exit 7
fi

printf "OK   Personal Team is selected\n"

section "Checks"
echo "Focusmap iOS appを接続中のiPhoneへインストールします。"
echo "XcodeにApple IDを入れていない場合は、Xcode > Settings > Accounts で無料Apple IDを追加してください。"
echo
echo "Xcode: $(xcodebuild -version | tr '\n' ' ')"
echo "接続先: ${EXPO_PUBLIC_FOCUSMAP_URL:-https://focusmap-official.com/dashboard}"
echo

npm run typecheck
npx expo-doctor

section "Build"
if [[ -n "$DEVICE_UDID" ]]; then
  build_for_device "id=${DEVICE_UDID}" "$TEAM_ID"
else
  build_for_device "platform=iOS,name=${DEVICE_NAME}" "$TEAM_ID"
fi

section "Install"
APP_PATH="$(latest_app_path)"
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  fail "ビルド済み .app が見つかりませんでした。" 9
fi

printf "App: %s\n" "$APP_PATH"
install_app "$DEVICE_ID" "$APP_PATH"

section "Launch check"
try_launch "$DEVICE_ID" "$BUNDLE_ID"

section "Done"
printf "Focusmap is installed on %s.\n" "$DEVICE_NAME"
