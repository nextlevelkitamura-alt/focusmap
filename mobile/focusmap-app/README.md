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
npm run ios:install:free
```

このコマンドは `xcrun devicectl` で接続済みiPhoneを検出し、`xcodebuild -allowProvisioningUpdates` で実機向けReleaseビルドを作ってから、生成された `Focusmap.app` をiPhoneへインストールします。初回起動時に「信頼されていないデベロッパ」が出た場合は、iPhoneの `設定 > 一般 > VPNとデバイス管理` で開発元を信頼します。

## Google認証

GoogleログインとGoogle Calendar連携は、アプリ内WebViewではなくSafariで認証します。認証が完了すると `focusmap://...` でFocusmapアプリへ戻り、WebView側にログイン状態またはカレンダー連携状態を反映します。

Googleログイン後のFocusmapセッションはiOS Keychainにも保存されます。次回起動時は最初にWebView内の復元ページを通り、WebViewのcookieが消えていても保存済みセッションから自動でログイン状態を戻します。明示的にログアウトした場合はKeychain側の保存セッションも削除されます。

Safariから自動で戻らない場合は、画面内の「アプリへ戻る」をタップしてください。

Xcodeのダウンロード完了後、明朝にまとめて進める場合:

```bash
cd mobile/focusmap-app
npm run ios:morning
```

事前チェック:

```bash
cd mobile/focusmap-app
npm run ios:doctor
```

署名証明書がない場合は、次を実行して生成されたXcodeプロジェクトを開き、Signing & Capabilitiesで自分のPersonal Teamを選びます。

```bash
npm run ios:signing
```

`No code signing certificates are available to use.` が出る場合も同じです。Xcodeで `Add Account...` から無料Apple IDを追加し、`Team` に自分のPersonal Teamを選んでから `npm run ios:install:free` を再実行します。

## 接続先を変える

標準では本番の `https://focusmap-official.com/dashboard` を開きます。Cloudflare tunnelなどを使う場合は、ビルド前に次の環境変数を指定します。

```bash
EXPO_PUBLIC_FOCUSMAP_URL="https://example.trycloudflare.com/dashboard" npm run ios:install:free
```

## 開発コマンド

```bash
npm run typecheck
npm run ios:doctor
npm run ios:morning
npm run ios:install:free
npm run ios:signing
npm run ios:device
npm run ios:device:release
```
