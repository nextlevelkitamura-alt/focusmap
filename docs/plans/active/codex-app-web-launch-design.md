# Codex.app Web起動設計

## 結論

本番Webから他人のMac上のCodex.appを開く主経路は、ユーザーのクリック直後に `codex://` deep link をブラウザから直接発火する方式にする。サーバー側で `/usr/bin/open` を実行しても、Cloud Run上で実行されるだけでユーザーPCのアプリは開かない。

localhost開発中だけは、Next API `/api/codex/open-repo` が同じMac上で動くため、API経由で `/usr/bin/open 'codex://?...'` を実行してよい。

## 根拠

- Codex.app はローカル検証で `codex://` URL scheme を登録している。インストール済みアプリの `Info.plist` に `CFBundleURLSchemes = codex` がある。
- Codex.app の同梱コードには `codex://?prompt=...&originUrl=...&path=...` を `newThread` として扱うdeep link parserがある。
- Apple公式ドキュメントは、カスタムURL schemeによりURLからアプリを特定コンテキストで起動できると説明している。
  - https://developer.apple.com/documentation/Xcode/defining-a-custom-url-scheme-for-your-app
- OpenAI公式のCodex app-serverは、ローカルのCodexとJSON-RPCで接続し、`thread/start` / `thread/resume` を呼べる。将来的なFocusmap Lite経由の安定連携に使える。
  - https://developers.openai.com/codex/app-server
- ブラウザ拡張のNative Messagingは、拡張からローカルネイティブアプリへ接続できる公式経路。ただし通常のWebページだけでは使えず、拡張とホストmanifestが必要。
  - https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
  - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/connectNative
- PWA protocol handlersはWebアプリ自身をprotocol handlerにする機能で、Codex.appを開く用途の本筋ではない。対応状況も限定的。
  - https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/protocol_handlers

## 実装方針

### 1. 本番Web

- `focusmap-official.com` などlocalhost以外では、クリックハンドラの同期処理として `window.location.href = codexDeepLink` を実行する。
- 保存、`ai_tasks` 作成、ログ同期、クリップボードコピーはその後に非同期で進める。
- 理由: `await saveDraft()` や `await fetch()` の後に外部アプリdeep linkを発火すると、ブラウザがユーザー操作由来ではない遷移として無視する場合がある。

### 2. localhost / Cloudflareスマホプレビュー

- `localhost` / `127.0.0.1` / `::1` では `/api/codex/open-repo` を使う。
- `*.trycloudflare.com` のスマホプレビューも同じNext dev serverへ到達するため、ローカルAPI経由でMacのCodex.app起動と即時runner dispatchを許可する。
- このAPIは同じMac上のNext dev serverでだけ意味がある。本番Cloud Runでは使わない。
- `CodexNodePanel` の「Codexに送る」は既存threadへの遷移を優先しない。ボタンは実体のある `codex://` リンクとして描画し、プロンプトをクリップボードへコピーする。リポジトリがあれば `dispatch_mode='auto'` で `ai_tasks` に登録し、Mac常駐runnerがCodex app-serverへ送る。すでに手動ハンドオフの `needs_input` レコードがある場合も、同じクリックでpendingの自動実行へ昇格する。
- localhostではブラウザ側クリップボード権限に依存しないよう、API側でもMacの `pbcopy` に同じプロンプトを書き込む。
- スマホ/本番Webでは、ユーザー操作直後に `codex://` deep link を発火してCodexアプリへ飛ばす。クリップボードコピーも同じクリック処理内で開始し、ブラウザの外部アプリ起動制約を避ける。

### 3. 本当に安定させる次段階

SaaSとして「プロンプト長、ブラウザ差、確認ダイアログ、未インストール検知」まで安定させるなら、Focusmap LiteをユーザーPCに入れる。

- Webは `ai_tasks` に依頼を保存する。
- Focusmap LiteがユーザーPCでタスクをpullする。
- Focusmap LiteがCodex app-server (`ws://127.0.0.1:7878`) または `codex://` を使ってCodex.appを開く。
- 成功/失敗/スレッドIDをFocusmapへ書き戻す。

この方式ならWebブラウザの外部アプリ起動制約を避けられる。
