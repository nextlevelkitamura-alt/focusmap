# Codex.app Web起動設計

## 結論

本番Webから他人のMac上のCodex.appを開く主経路は、ユーザーのクリック直後に `codex://` deep link をブラウザから直接発火する方式にする。サーバー側で `/usr/bin/open` を実行しても、Cloud Run上で実行されるだけでユーザーPCのアプリは開かない。

localhost開発中だけは、Next API `/api/codex/open-repo` が同じMac上で動くため、API経由で `/usr/bin/open 'codex://?...'` を実行してよい。

## 根拠

- Codex.app はローカル検証で `codex://` URL scheme を登録している。インストール済みアプリの `Info.plist` に `CFBundleURLSchemes = codex` がある。
- Codex.app の同梱コードには `codex://?prompt=...&originUrl=...&path=...` を扱うdeep link parserがあるが、Focusmapでは日本語promptの文字化けとURL長制限を避けるため、prompt本文はqueryへ載せずクリップボードを正にする。
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
- `CodexNodePanel` の「Codexに送る」は既存threadへの遷移を優先しない。ボタンはpromptなしの `codex://?path=...&originUrl=...` リンクとして描画し、プロンプト本文はクリップボードへコピーする。標準導線は `dispatch_mode='manual'` で `ai_tasks` に登録し、人間がCodex.app側で最終送信する。自動実行を使う場合だけ専用導線が `dispatch_mode='auto'` を渡す。
- localhostではブラウザ側クリップボード権限に依存しないよう、API側でもMacの `pbcopy` に同じプロンプトを書き込む。
- スマホ/本番Webでは、ユーザー操作直後に `codex://` deep link を発火してCodexアプリへ飛ばす。クリップボードコピーも同じクリック処理内で開始し、ブラウザの外部アプリ起動制約を避ける。

### 3. Focusmap Lite セットアップ経由の安定導線

SaaSとして「プロンプト長、ブラウザ差、確認ダイアログ、未インストール検知」まで安定させる主経路は、Focusmap LiteをユーザーPCに入れる方式にする。

- Webは `ai_tasks` に依頼を保存する。
- `CodexNodePanel` は `/api/ai-runners` を見て、2分以内にheartbeatした `codex_app` / `codex` runnerがある場合だけ `dispatch_mode='auto'` を使う。
- runner未接続時は `dispatch_mode='manual'` に落とし、プロンプトのコピーと `codex://` 起動だけを試し、画面内にMacセットアップCTAを出す。
- スマホ判定時は `codex://` ではなくChatGPTアプリを直接狙う。iOS/iPadOSは公式Codex mobile入口の `https://chatgpt.com/codex/mobile/` をUniversal Linkとして使い、Android Chromeは `intent://chatgpt.com/codex/mobile/#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fcodex%2Fmobile%2F;end` でChatGPTアプリへ `chatgpt.com/codex/mobile/` を渡す。Focusmap iOSアプリ内WebViewではアンカー遷移ではなく `focusmap:openExternal` bridgeでReact Native側の `Linking.openURL(url)` に渡す。外部Webから任意のCodex画面へプロンプトを注入する公開deep linkは確認できないため、Focusmapは「コピー済み → ChatGPTアプリ/Codex入口を開く」までを保証範囲にする。
- Focusmap LiteがユーザーPCで `codex_app` タスクをpullする。
- Focusmap LiteがCodex app-server (`ws://127.0.0.1:7878`) に `initialize` → `thread/start|thread/resume` → `turn/start` を送り、Codex.appのスレッドを開く。
- 成功/失敗/スレッドIDをFocusmapへ書き戻す。
- `scripts/install.sh` はWeb同梱の `focusmap-agent.tar.gz` を優先導入し、Codex.app/Codex CLIが検出できるMacでは `com.focusmap-official.codex-app-server.plist` も作る。

この方式ならWebブラウザの外部アプリ起動制約を避けられる。

## アプリ化した場合の比較

| 方式 | Codex.appを開けるか | 確認ダイアログ | 他人のPCで動く条件 | 評価 |
|---|---|---|---|---|
| 通常Web | 開ける（`codex://`） | 出ることがある | Codex.appインストール済み、ユーザークリック直後 | 最小実装。今の本番向け本筋 |
| PWA / Safari Web App | 基本は通常Webと同じ | 出ることがある | PWAインストール済み | 「アプリっぽいWeb」なのでOS操作権限は増えない |
| Electron/Tauriデスクトップアプリ | 開ける | 原則ブラウザ確認なし | Focusmapアプリをインストール済み | 単体アプリ化なら可能。ただし配布・更新・署名が必要 |
| Focusmap Lite常駐アプリ + Web | 開ける | Web側の外部アプリ確認は不要 | Liteをインストール、ログイン/トークン連携済み | SaaSとして一番現実的。Web UIを維持できる |
| Chrome拡張 + Native Messaging | 開ける | Web側の外部アプリ確認は不要 | 拡張 + native hostをインストール | 強いが配布・審査・設定が重い |

### Electron/Tauriでできること

Electronなら `shell.openExternal(url)` でOSの既定アプリとしてURLを開ける。Tauriなら opener plugin の `openUrl()` / `openPath()` でURLやファイルをOS側に渡せる。つまりFocusmapをMacアプリ化すれば、promptなしの `codex://?path=...` とOSクリップボード書き込みをブラウザ制約なしで実行できる。

ただし、これは「Focusmap自体をユーザーにインストールしてもらう」設計になる。Web SaaSとしての軽さは落ちる。

### 推奨

Focusmap全体をいきなりElectron/Tauriアプリにするより、Web本体は維持し、Mac側だけ `Focusmap Lite` として小さな常駐アプリを配る方がよい。

理由:

- 既存のWeb UI/認証/課金/チーム管理を維持できる。
- Codex.app起動、ローカルファイル、app-server接続だけをローカルアプリに閉じ込められる。
- 将来Windows対応やChrome拡張対応にも逃げやすい。
- 本番Webからは `ai_tasks` を作るだけにでき、ユーザーPC側の実行はLiteに任せられる。
