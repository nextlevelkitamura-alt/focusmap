# Focusmap Lite — Mac常駐エージェント / Macアプリ化計画

作成: 2026-05-27
目的: Focusmap を「Webで操作している感覚」のまま、実行はユーザーのMac内で行う形にする。

---

## 1. 結論

Focusmap は **Webアプリ単体** ではなく、次の2層構成にする。

```text
Focusmap Web
  - チャット、履歴、実行ログ、承認、設定
  - ai_tasks に指示を書き込む
  - ランナー状態を表示する

Focusmap Lite.app
  - ユーザーのMacに入る常駐アプリ
  - 起動時にログイン項目/LaunchAgentを登録
  - terminal / Playwright / GWS / Google認証 / ローカルファイルを扱う
  - 実行結果とログをFocusmap Webへ返す
```

ユーザー体験としては「Webでボタンを押すだけ」に寄せるが、PCを触る処理は必ず Mac 側の `Focusmap Lite.app` が実行する。
これは Claude Code / Codex と同じ発想で、Web UI がPCを直接触るのではなく、ローカルプロセスが権限を持つ。

---

## 2. なぜMacアプリ化するか

ブラウザ上の純粋なWebアプリは、セキュリティ上、ユーザーのPCのターミナル・任意ファイル・ログイン済みブラウザを自由には操作できない。File System API もユーザー許可が前提で、ターミナル実行まではできない。

一方、macOSにインストールされたアプリ/常駐プロセスなら、ユーザーが許可した範囲で次を扱える。

- Google / GWS のローカルOAuth認証
- Playwright の永続ブラウザプロファイル
- ターミナルコマンド
- ローカルファイル/リポジトリ
- Chrome / Arc / Safari のログイン済みセッションに近い操作
- launchd / ログイン項目による常駐

Apple公式上も、Mac App Store外配布では Developer ID 署名と notarization が現実的な配布ルートになる。
参考:
- Apple: Distribute outside the Mac App Store
  https://help.apple.com/xcode/mac/current/en.lproj/dev033e997ca.html
- Apple: Notarizing macOS software before distribution
  https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution
- Apple: Service Management
  https://developer.apple.com/documentation/servicemanagement/

---

## 3. 目標UX

### 初回導入

```text
1. Webの自動化設定画面を開く
2. 「Focusmap Liteをインストール」ボタンを押す
3. FocusmapLite.dmg または .pkg がダウンロードされる
4. アプリを開く
5. Webの「このMacを接続」ボタンを押す
6. focusmap://pair?token=... が開き、Focusmap Lite がペアリング
7. Focusmap Lite が必要な権限チェックを順に出す
8. Web画面が自動で「このMacで実行可能」に変わる
```

### 2回目以降

```text
1. Webで自動化チャットに入力
2. ai_tasks に投入
3. Focusmap Lite がバックグラウンドでclaim
4. ローカルでPlaywright/GWS/terminal実行
5. Webに実行ログが流れる
6. 完了結果がチャット履歴に残る
```

### 認証切れ

```text
1. Web側に「Google認証が切れています」と表示
2. 「このMacで再認証」を押す
3. Focusmap Lite がローカルブラウザを開く
4. ユーザーがGoogleログイン
5. 認証情報はMac内に保存
6. Web側の状態がOKに戻る
```

---

## 4. 採用アーキテクチャ

### 4.1 既存資産

既に以下が存在する。

| 項目 | 既存 | 使い方 |
|---|---|---|
| タスク投入 | `ai_tasks` | Webからの指示キュー |
| ランナー登録 | `ai_runners` | Macのオンライン状態 |
| ハートビート | `/api/ai-runners/heartbeat` | 30秒〜60秒周期 |
| claim | `/api/ai-runners/claim` | 実行権の取得 |
| ローカル実行 | `scripts/task-runner.ts` | Codex/Claude系の土台 |
| 軽量agent | `scripts/focusmap-agent/` | Playwright/GWS系の土台 |
| インストーラ | `scripts/install.sh` | CLI版の土台 |
| 設定画面 | `/dashboard/settings/automation` | Web側の導線 |

### 4.2 目指す最終形

```text
FocusmapLite.app
  Contents/
    MacOS/FocusmapLite          # Swift/SwiftUI or Tauri shell
    Resources/focusmap-agent    # Node/Bun/compiled sidecar
    Resources/playwright        # 初回導入 or lazy install

~/Library/Application Support/FocusmapLite/
  config.json                   # agent token, runner id, api url
  auth/                         # GWS/Playwright/OAuth local files
  browser-profile/              # Playwright persistent context
  logs/

~/Library/LaunchAgents/com.focusmap.lite.agent.plist
  Focusmap Lite の常駐プロセスを起動
```

### 4.3 技術選定

| レイヤー | 採用 | 理由 |
|---|---|---|
| Macアプリ外枠 | SwiftUI Menu Bar App | macOS権限、URL scheme、ログイン項目との相性が良い |
| 実行エンジン | 既存 `focusmap-agent` Node sidecar | Playwright/GWS/AI処理の既存資産を活かす |
| 常駐化 | ServiceManagement + LaunchAgent fallback | 近代APIを優先し、失敗時にplistへ逃がす |
| Web連携 | Supabase + Focusmap API | 既存 `ai_tasks` / `ai_runners` を活用 |
| ペアリング | `focusmap://pair?token=...` | Webからアプリへ自然に渡せる |
| 配布 | Developer ID署名 + notarized DMG/PKG | Gatekeeper警告を避ける |

---

## 5. 権限モデル

「PCを自由に触る」はプロダクト上は危険なので、自由度を保ちつつスコープで分ける。

| 権限 | できること | 初回UI |
|---|---|---|
| Terminal | 許可済みコマンド/リポ内コマンド実行 | 「ターミナル実行を許可」 |
| Browser | Playwrightでサイト操作 | 「ブラウザ自動化を有効化」 |
| Google Workspace | Calendar/Sheets/Drive/Docs | 「Google Workspace認証」 |
| Local Files | 指定フォルダの読み書き | 「フォルダを選択」 |
| Full Disk Access | 必要時のみ | macOS設定画面へ誘導 |

### 実行前ガード

危険操作は自動実行しない。

| 操作 | 扱い |
|---|---|
| 指定サイト巡回、情報取得 | 自動実行OK |
| Google Sheets追記 | 初回承認後は自動OK |
| ファイル作成/更新 | 許可フォルダ内のみOK |
| `rm`, `git push`, 決済, 送信, 投稿 | 毎回承認 |
| 未許可ドメイン操作 | ブロック |

---

## 6. Webから操作している感覚を作るUI

### 6.1 Web側

自動化チャットは常にWebで完結して見えるようにする。

- チャット履歴
- 実行中ステップ
- ライブログ
- 「Macでブラウザを開いて認証」ボタン
- 「この操作を許可」承認ボタン
- 「停止」ボタン
- 「再実行」ボタン

### 6.2 Mac側

Macアプリは最小限にする。

- メニューバー常駐アイコン
- 状態: Online / Running / Needs Auth / Paused
- Open Focusmap
- Reconnect
- Open Logs
- Quit

普段ユーザーはMacアプリを触らない。Webが主UI。

---

## 7. ワンタップ導入の現実ライン

完全な「Webから無音インストール」はmacOSではできない。ユーザーの同意なしにアプリ導入・常駐化はできない。
ただし、次の形ならほぼワンタップ体験にできる。

### MVP導入

```text
Webボタン
  ↓
FocusmapLite.pkg ダウンロード
  ↓
開く
  ↓
インストーラ完了
  ↓
Webの接続ボタンで focusmap://pair
```

### β版の代替

```text
Webボタン
  ↓
ターミナルコマンドをコピー
  ↓
curl -sSL https://focusmap-official.com/install.sh | sh -s -- <token>
```

既存の `scripts/install.sh` はこのβ導線として残す。
正式版は `Focusmap Lite.app` / `.pkg` に寄せる。

---

## 8. 実装フェーズ

### Phase 0: 設計固定と既存資産整理

完了条件:
- この計画書を正本にする
- `saas-design-installer.md` は旧CLI中心設計として扱い、本計画へリンク
- Web設定画面の文言を「Focusmap Lite」に統一する

### Phase 1: CLI版を「ワンタップ風」にする

目的: 最短で実用化する。

実装:
- `/api/agents/token` を本番利用できる形にする
- `/install.sh` をCloud Runで配信
- `/dashboard/settings/automation` に「Focusmap Liteを導入」CTA
- CTAでOS判定し、Macなら導入コマンド/ダウンロードを表示
- install.sh からユーザーに service role key を入れさせない
- agent token だけで runner が heartbeat/claim できるようにする
- GWS/Playwright認証状態を `ai_runners.metadata` に反映

完了条件:
- Webから発行したtokenだけでMacが登録される
- 設定画面で「このMacで実行可能」と表示される
- 自動化チャットからPlaywrightタスクが1件完走する

### Phase 2: Focusmap Lite.app MVP

目的: ターミナルを触らない導入へ移行する。

実装:
- SwiftUIメニューバーアプリ作成
- `focusmap://pair` URL scheme
- 既存 `focusmap-agent` をsidecar化
- app起動時にagentを開始/停止/再起動
- ログイン項目登録
- `~/Library/Application Support/FocusmapLite` 管理
- ログ表示
- Webの「このMacを接続」からpairing

完了条件:
- ユーザーはアプリを開いてWebの接続ボタンを押すだけ
- ターミナル不要
- Web画面でrunner online確認
- アプリ再起動/ログアウト後も常駐復帰

### Phase 3: 認証とブラウザ自動化をMac側へ寄せる

実装:
- GWS / Google Workspace MCP の導入・認証
- Playwright persistent browser profile
- 「認証が必要」イベントをWebに返す
- WebボタンからMac側ブラウザを開く
- 許可ドメイン設定
- 実行ログ/スクリーンショットをWebへ返す

完了条件:
- Google Sheets追記タスクがMac側認証で完走
- ログインが必要なWebサイトをPlaywrightで操作できる
- 認証切れ時にWebから再認証できる

### Phase 4: 配布品質

実装:
- Developer ID signing
- Hardened Runtime
- notarization
- DMG/PKG生成
- 自動アップデート
- rollback
- crash report / diagnostic upload

完了条件:
- Gatekeeper警告なしで起動
- Webから最新バージョン確認
- アプリの自動更新が動く

---

## 9. API / DB 追加仕様

### ai_runners.metadata

```json
{
  "app": "focusmap-lite",
  "app_version": "0.1.0",
  "agent_version": "0.1.0",
  "install_method": "pkg|curl|dev",
  "gws_installed": true,
  "gws_authenticated": true,
  "playwright_installed": true,
  "browser_profile_ready": true,
  "terminal_permission": "limited",
  "allowed_domains": ["example.com"],
  "last_auth_check_at": "2026-05-27T00:00:00Z"
}
```

### agent_commands

WebからMac側へ「認証を開く」「停止」「ログ取得」などを送るための軽量キュー。

```sql
agent_commands (
  id uuid primary key,
  runner_id uuid not null,
  user_id uuid not null,
  type text not null,
  payload jsonb default '{}',
  status text default 'pending',
  created_at timestamptz default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  error text
)
```

最初は `ai_tasks` に寄せてもよいが、操作系コマンドは分けた方が安全。

コマンド種別:
- `open_google_auth`
- `open_gws_auth`
- `open_browser_auth`
- `restart_agent`
- `pause_agent`
- `resume_agent`
- `upload_logs`
- `scan_capabilities`

---

## 10. 成功判定

この計画が「完成」と言える条件:

- Web設定画面に Focusmap Lite 導入CTAがある
- Mac側に入れるものが1つに見える
- 初回ペアリングが `focusmap://pair` で完了する
- Webから指示した自動化がMac側で動く
- Google/ブラウザ/ターミナル認証はMac側に残る
- 実行中ログがWebチャットに出る
- 認証切れ時にWebからMac側再認証へ誘導できる
- Gatekeeperに引っかからない配布ルートがある

---

## 11. 直近の実装順

1. `scripts/install.sh` から service role key 入力をなくす
2. `agent_token` だけで `heartbeat` / `claim` / `result update` できるAPIを整える
3. 設定画面のCTAを「Focusmap Liteを導入」に変更
4. `ai_runners.metadata` に GWS / Playwright / terminal 状態を書けるようにする
5. `agent_commands` を追加
6. Focusmap Lite.app の最小メニューバーアプリを作る
7. `focusmap://pair` を実装
8. sidecarとして `focusmap-agent` を起動
9. 署名/公証/DMG化

---

## 12. 判断

Focusmap は「Macアプリにする」のではなく、**Webアプリを主UIにしたMac常駐アプリ付きSaaS** にする。
ユーザーはWebで操作している感覚のまま、実行権限と認証はMac側に置く。

これが、PCを自由に動かしたい要件と、Webサービスとして提供したい要件を両立する最短ルート。
