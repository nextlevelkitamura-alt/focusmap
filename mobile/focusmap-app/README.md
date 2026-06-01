# Focusmap iOS

FocusmapのiPhone向けExpoアプリです。最初の版は既存のNext.jsダッシュボードをネイティブWebViewで表示し、起動画面・読み込み状態・エラー復旧だけをReact Native側で持ちます。

## 無料でiPhoneへ入れる

Apple Developer Programに入らずに試す場合は、Xcodeの無料Personal Teamで実機へ直接インストールします。この方式はホーム画面にFocusmapアイコンが出ますが、署名は7日で切れるため、継続利用には再インストールが必要です。

必要なもの:

- Mac App Store版のXcode本体
- Xcodeに追加した無料Apple ID
- USB接続したiPhone

初回だけ:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

インストール:

```bash
cd mobile/focusmap-app
./scripts/install-ios-free.sh
```

うまく署名できない場合は、次を実行して生成されたXcodeプロジェクトを開き、Signing & Capabilitiesで自分のPersonal Teamを選びます。

```bash
npm run ios:prebuild
open ios/*.xcworkspace
```

## 接続先を変える

標準では本番の `https://focusmap-official.com/dashboard` を開きます。Cloudflare tunnelなどを使う場合は、ビルド前に次の環境変数を指定します。

```bash
EXPO_PUBLIC_FOCUSMAP_URL="https://example.trycloudflare.com/dashboard" npm run ios:device
```

## 開発コマンド

```bash
npm run typecheck
npm run ios:device
npm run ios:device:release
```
