# しかみか (Shikumika) - プロジェクト全体像

> このファイルは /next で自動更新されます

## 目的
マインドマップとタスク管理を統合し、Google カレンダーと連携した統合的なプロダクティビティアプリ

## 現在の状況
Phase 1: Googleカレンダー完全連携（MVP）- 開発中
コード規模: 約15,000行 / 100ファイル（中規模）

---

## ダッシュボード構成（3ペイン）

### 📍 左サイドバー (`LeftSidebar`)
**ファイル**: `src/components/dashboard/left-sidebar.tsx` (118行)

**機能:**
- **Goals（目標）選択** - 目標の一覧表示・選択
- **Projects（プロジェクト）選択** - プロジェクトの階層表示・選択
- 選択したプロジェクトに応じて、中央ペイン・右ペインの内容が変化

**データフロー:**
```
Goals → Projects → TaskGroups → Tasks
```

---

### 📍 中央ペイン (`CenterPane`)
**ファイル**:
- `src/components/dashboard/center-pane.tsx` (1,147行)
- `src/components/dashboard/mind-map.tsx` (2,266行)

**2つのビューモード:**

#### 1. マインドマップビュー（上半分）
**コンポーネント**: `MindMap`
- ReactFlow によるノードベースのマインドマップ表示
- Dagre アルゴリズムで自動レイアウト計算
- ノード種類: Project / TaskGroup / Task
- ノードの色分け・優先度・進捗表示
- ドラッグ操作による並び替え
- 高さ調整可能（スプリッタ）

**主な操作:**
- グループ/タスクの作成・編集・削除
- ノードのドラッグで並び替え
- ノードをクリックで詳細表示

#### 2. リストビュー（下半分）
**コンポーネント**: `CenterPane`
- タスクグループの折りたたみ表示
- ツリー形式でタスクの親子関係を表示（最大6階層）
- ドラッグ&ドロップでグループ内・グループ間のタスク移動
- インラインエディタ（タイトル直接編集）
- タイマー機能（Focusボタン、一時停止、完了）
- 優先度バッジ（高/中/低）
- 見積もり時間設定（手動/自動集計）
- スケジュール日時設定
- Google Calendar 同期ステータス表示

**主な操作:**
- タスクの新規作成（自動フォーカス）
- タイトル編集（Enterで確定）
- チェックボックスで完了/未完了
- タイマー開始/停止/完了
- カレンダー選択・同期

---

### 📍 右サイドバー (`RightSidebar`)
**ファイル**:
- `src/components/dashboard/right-sidebar.tsx` (90行)
- `src/components/dashboard/sidebar-calendar.tsx` (160行)
- `src/components/calendar/*.tsx` (11ファイル, 1,867行)

**機能:**
- **Google Calendar 連携**
  - カレンダーの表示/非表示切り替え
  - 複数カレンダー対応
  - イベント同期
  - 空き時間検索

**4つのビューモード:**
1. **月ビュー** (`CalendarMonthView`) - 月間カレンダー表示
2. **週ビュー** (`CalendarWeekView`) - 7日間のグリッド表示
3. **3日ビュー** (`Calendar3DayView`) - コンパクト表示用
4. **日ビュー** (`CalendarDayView`) - 1日の時間軸詳細表示

**カレンダー機能:**
- Google Calendar イベント表示
- スケジュール済みタスク表示
- ドラッグ&ドロップで時間変更
- タスクをカレンダーにドロップしてスケジュール設定
- ミニカレンダー（月選択）
- カレンダー選択（複数カレンダーの表示/非表示）

---

## 各ペインの連携

```
左サイドバー                中央ペイン                    右サイドバー
┌──────────┐              ┌──────────┐              ┌──────────┐
│ Goals    │──選択──────→│ MindMap  │              │ Calendar  │
│          │              │          │──ドラッグ──→│          │
│Projects  │──選択──────→│ TaskList │              │ Events   │
└──────────┘              └──────────┘              └──────────┘
```

**データフロー:**
1. 左ペインでプロジェクトを選択
2. 中央ペインに該当するタスクグループ・タスクが表示
3. 中央ペインのタスクを右ペインのカレンダーにドラッグしてスケジュール
4. 右ペインでタスクの時間を変更すると、中央ペインのタスクにも反映

---

## 主要な Hooks

| Hook | 用途 | 使用箇所 |
|------|------|----------|
| `useMindMapSync` | Supabase CRUD・同期 | dashboard-client.tsx |
| `useTaskCalendarSync` | タスク⇄Google Calendar同期 | center-pane.tsx |
| `useCalendarEvents` | Calendarイベント取得・ローカル/DBキャッシュ先出し | sidebar-calendar.tsx |
| `useCalendars` | ユーザーカレンダー一覧・選択管理 | calendar-selector.tsx |
| `useTimer` | タスクタイマー | center-pane.tsx |
| `useMemoAiTasks` | マインドマップ/メモ起点の最新 `ai_tasks` 状態を取得し、Codex状態バッジへ反映 | mind-map.tsx / mindmap-linked-memos-dialog.tsx |

---

## 現在の主要仕様

このセクションは、チャット履歴がなくても実装意図を復元できるようにするための現行仕様メモ。主要なUI・同期方式・データフローを変えた場合は、実装と同じコミットで更新する。

### ダッシュボードナビゲーション

- デスクトップ上部タブは `Todo` / `メモ` / `マップ` / `チャット` の順に表示する。
- モバイル下部ナビは `Todo` / `メモ` / `マップ` / `チャット` / `設定` の順に表示し、`チャット` を強調表示の対象にする。
- モバイル下部ナビとデスクトップヘッダーの `設定` は、通常利用では `/dashboard/settings` へルート遷移せず、`DashboardClient` 内の `settings` ビューとして `SettingsOverview` を表示する。マップやTodoのクライアント状態を破棄しないことで、設定へ移動して戻る時の再取得・マップ再初期化を避ける。設定内の詳細カテゴリリンクは従来通り `/dashboard/settings/*` を使う。
- モバイル `Todo` 画面は、予定タイムラインだけでなく `予定` / `AI` の切替を持つ。`AI` 側はデスクトップの `Todo > AI実行` と同じ `AiExecutionTimeline` を使い、`ai_tasks` / scheduled AI tasks / Codex状態 / follow-up送信をWeb・Mac・iPhoneで同じAPI経由で表示する。
- モバイル `Todo > 予定` のヘッダーは、下へ引くと更新アイコンを表示し、しきい値を超えて離すと `useCalendarEvents.syncNow({ silent: true })` でカレンダー予定だけを強制更新する。iPhoneアプリのWebViewネイティブpull-to-refreshは画面全体のリロードになるため無効にし、このヘッダーpull更新を標準導線にする。
- モバイル日次カレンダーの予定/タスク長押しドラッグは、ドラッグ中だけカレンダーグリッドとページ全体のtouch scroll / overscrollをロックする。移動中は画面やWebViewのpull-to-refreshを動かさず、予定ブロックの時間変更プレビューだけを動かす。
- モバイル `Todo > 予定` の右下プラスから開く新規タスク追加シートは黒背景のボトムシートにし、日付/時刻、所要/カレンダー、プロジェクト/優先度、通知/サブタスクを2列で入力する。`所要` は通常時は値だけを表示し、タップ時だけ5分/15分/30分等のプリセットとカスタムホイール導線をインライン展開する。
- 上部の `SpaceProjectSwitcher` は左のスペース選択と右のプロジェクト選択を独立状態として扱う。右側でプロジェクトを選択・作成・編集しても左側の `selectedSpaceId` は変更せず、スペースは左側のスペースメニューで明示的に選んだ時だけ切り替える。
- `Todo` タブの `メモ + カレンダー` サブビューは、サブビュータブ自体を見出しとして扱う。中央ペイン内に重複する「今日する」見出しや説明文は置かず、カラム切替・カレンダー選択・今日するメモ追加ボタンだけを薄いツールバーにまとめる。
- `Todo` タブ左側のメモカードは、`メモ` 画面と同じ `WishlistCardDetail` 編集シートを開く。見出し・本文・タグ・画像・予定化などのメモ編集導線は左ペインからも同じ挙動にする。

### メモとマップ追加済みの同期

- メモの `マップ追加済み` 判定は、全プロジェクト横断で実在するマップノード（`tasks.deleted_at is null`）に対応しているかを基準にする。今開いているプロジェクトだけで判定しない。
- `memo_node_links` の active link または旧 `ai_source_payload.mindmap_links` があっても、対応する `task_id` が存在しない場合はマップ上にないものとして扱う。メモ一覧/詳細取得時に古い参照を自動で外し、必要なら未予定へ戻す。
- マップノードを削除した時は、削除対象の子孫ノードも含めて元メモとの対応を外す。そのメモに他の実在マップノードが残っていなければ、元メモは削除せず `未予定`（`memo_status='unsorted'`）へ戻す。
- ただし元メモが `今日する` / `予定済み` / `完了` の場合、その状態を優先し、マップノード削除だけでは `未予定` へ戻さない。
- マップ削除後はUndoスタックへ復元用スナップショットを積む。トーストの `元に戻す` と `Cmd/Ctrl+Z` は同じUndo処理を呼び、削除したノード群・元メモ対応・未予定戻し前のメモ状態をまとめて復元する。

### カレンダー取得・キャッシュ

- `useCalendarEvents` は、同一画面内のメモリキャッシュに加えて `sessionStorage` / `localStorage` に予定を保存する。表示用TTLは12時間、再検証は1分を目安にし、アプリ/Webの再起動後も手元の予定を先に描画してから裏で更新する。
- `useCalendars` はカレンダー一覧と選択状態も `localStorage` に保存し、Macアプリ/スマホ起動直後に選択カレンダーIDを復元する。これによりイベントキャッシュキーが初回描画から確定し、`primary` だけを一瞬表示してから全カレンダーへ増える段階表示を避ける。
- 選択カレンダーIDが空配列の場合、`useCalendarEvents` はGoogle Calendar APIのデフォルト `primary` 取得へフォールバックせず、空予定として扱う。カレンダー選択が未確定の間は予定取得を開始しない。
- `/api/calendar/events/list` は `forceSync=false` かつ `calendar_events` に対象期間のキャッシュがある場合、Google Calendar APIを待たずにDBキャッシュを返す。返却時も `task_id` / 優先度 / 見積時間 / 完了状態 / カレンダー色 / 祝日カレンダー除外を付け直す。
- DBキャッシュが古い場合、APIは `fromCache: true` / `needsRefresh: true` を返し、フロントは表示後に `forceSync=true` のサイレント同期を1回走らせる。`forceSync=true`、手動更新、定期自動更新、DBキャッシュなしの初回はGoogle Calendar APIから取得して `calendar_events` を更新する。

### マインドマップとCodex.app連携

- ノードからCodexへ渡す場合、Focusmapは作業本体を裏側で完結させるのではなく、Codex.app側を主軸にする。
- Focusmap側は `ai_tasks` に待機レコードを作り、プロンプトをクリップボードへコピーし、Codex.appのチャットを開く補助をする。
- マインドマップのメモ編集パネル（`CodexNodePanel`）では、「Codexに送る」から同じ手動ハンドオフを実行する。押下直後にメモ見出し本文とメモ詳細本文だけを改行区切りでクリップボードへコピーし、既存threadへの遷移は狙わず、Mac/デスクトップでは実体のある `codex://?prompt=...&path=...&originUrl=...` リンクとしてCodex.appを開く。スマホではブラウザURLではなく、iOS/iPadOSは `com.openai.chat://https://chatgpt.com/codex/mobile/`、Androidは `intent://chatgpt.com/codex/mobile/#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fcodex%2Fmobile%2F;end` を開き、ChatGPTアプリ側のCodex mobile入口を優先する。どちらもコピーと外部アプリ起動をクリック直後に開始し、保存や `ai_tasks` 登録の完了を待たない。
- Codex.app連携の主導線は手動ハンドオフ。オンラインrunnerがあっても、ノードパネルの「Codexに送る」は `dispatch_mode='manual'` の `ai_tasks` を作り、メモ見出し本文とメモ詳細本文だけをラベルなしでクリップボードへコピーし、Codex.appを開く。`app-server` 経由の自動turn作成はCodex.app/スマホRemote ControlのUI同期が不安定なため、通常導線では前提にしない。
- localhost と `*.trycloudflare.com` のスマホプレビューでは、デスクトップの場合だけローカルAPI `/api/codex/open-repo` からMacの `pbcopy`、`open codex://...`、Codex.appのactivateを実行する。スマホ判定時はChatGPT mobile入口を優先する。ブラウザが外部アプリ起動を止めても、プロンプトはクリップボードに残し、Focusmap側は `ai_tasks` の `プロンプト待ち` として状態を追う。
- Codex.appの新規スレッド作成・リポジトリ選択・貼り付け済み送信は、OS/アプリ側の公開API制約により完全自動化できない前提。Focusmapは「プロンプト待ち」「実行中」「確認待ち」を表示し、`/api/codex/sync-node` と `~/.codex/state_5.sqlite` / rollout JSONL から状態確認とログ同期に徹する。
- Focusmap Lite `scripts/focusmap-agent` は、Codex.appまたはCodex CLIを検出したMacでは `codex_app` executorをheartbeatに含める。`codex_app` taskをclaimした場合は `ws://127.0.0.1:7878` のCodex app-serverへ `initialize` → `thread/start|thread/resume` → `turn/start` を送り、スレッドURL・ログ・確認待ち状態を `ai_tasks.result` に書き戻す。
- `scripts/install.sh` はWeb同梱の `focusmap-agent.tar.gz` を優先導入し、Codex.app/Codex CLIがあるMacでは `~/.focusmap/bin/run-codex-app-server.sh` と `~/Library/LaunchAgents/com.focusmap-official.codex-app-server.plist` も作成する。Codex.app未導入の場合は警告だけ出し、Codex導入後に再実行すれば `codex_app` executorが有効になる。
- プロンプト本文は、メモ見出しなどのラベルを足さず、ノード本文/メモ本文を改行区切りでそのまま渡す。
- Web起動の詳細設計は `docs/plans/active/codex-app-web-launch-design.md` を参照する。
- ノードの状態表示は `src/lib/codex-run-state.ts` の `getCodexTaskUiState` を正とする。
  - `codex_manual_handoff=true` かつ `codex_thread_id` 未検出: `プロンプト待ち`（青）
  - `status=running` または `result.codex_run_state=running`: `実行中`
  - `awaiting_approval` / `needs_input` / `failed`: `確認待ち`
  - `completed`: マップ上のCodex状態表示から外す
- 実行中ノードは、右上の小さなスピナーではなく、ノード外周の緑色の動きで示す。
- マインドマップ右上の更新アイコンは、Web側の `ai_tasks` 状態を手動再取得するためのもの。常駐runnerの即時スキャン強制ではない。

### Codex同期ポリシー

- `ai_tasks` が全ての起点。Codex.app連携では `executor='codex_app'` または `executor='codex'` を使う。
- Mac常駐 `scripts/task-runner.ts` が `~/.codex/state_5.sqlite` と rollout JSONL を読み、`ai_tasks.result` に状態を同期する。
- 実行中・スレッド検出直後は体感優先で短い間隔で追う。launchdの通常起動に加え、実行中は3秒間隔の追加follow-upを最大4回入れる。ローカル/プレビュー上のマップ表示中とノードパネル表示中は `/api/codex/sync-node` を約3秒間隔で呼び、Codex.app側で貼り付け送信されたthreadを検出して `ai_tasks.result` に反映する。
- Codex thread未検出の高速探索は開始後2分まで。2分を超えて見つからない場合は `monitoring_lost` として確認待ちにする。
- 確認待ち・手動貼り付け待ち・needs_inputは、頻繁に追わない。`result.codex_last_checked_at` を使い、通常は30分ごとの再確認に抑える。
- Focusmapで完了済みになったノードに紐づくCodex threadのアーカイブ/削除確認も、常時ではなく30分間隔の巡回に抑える。
- Web側の `useMemoAiTasks` / `useAiTasks` は、実行中またはプロンプト待ちのCodexタスクがある場合だけ3秒更新。実行中がない場合は `useMemoAiTasks` は1時間更新、`useAiTasks` は30秒更新に後退し、必要なら手動更新アイコンで即時取得する。

### Focusmap MacアプリMVP

- Mac版は、FocusmapのUIをSwiftUI等で作り直さない。既存のNext.js/React UIをElectronのBrowserWindow内で表示し、ブラウザではできないローカル機能だけをElectronメインプロセス側へ寄せる。
- 開発・自分用起動は `npm run mac:dev`。起動直後は軽量なローディング画面付きのメインウィンドウを先に開き、その後非同期で `http://127.0.0.1:3001/dashboard?desktop=1&source=mac` に遷移する。3001にFocusmapがいなければ、その時点で `next dev -p 3001` を自動起動し、待機中にユーザーへ画面を返す。ブラウザ版 `npm run dev` と分けるため、Macアプリ用には `npm run dev:desktop` を使う。
- Dock/FinderからMacアプリを起動した場合、3001番ポートが受け付け可能なら `/api/desktop/health` の完了を待たずにダッシュボードへ遷移する。ヘルスチェックはバックグラウンドで継続し、起動中画面のまま既存インスタンスが再フォーカスされた場合も再読み込みを試みる。起動ログは `~/.focusmap/logs/desktop-app.log` に保存する。
- Dockアイコンの設定は起動を妨げない。`Resources/icon.icns` の読み込みに失敗した場合はASAR内の `assets/icon.png` を試し、それでも失敗した場合はログだけ残してウィンドウ生成とダッシュボード遷移を継続する。
- 配布/パッケージ版をFinderやDockから起動した場合、macOSのPATHには `node` が無いことがあるため、同梱Next standaloneやagent CLIは `node` コマンドに依存しない。パッケージ版ではElectron本体を `ELECTRON_RUN_AS_NODE=1` でNode実行モードにして子プロセスを起動する。子プロセスのspawn失敗はメインプロセス例外にせず、接続状態ログに出す。
- MacアプリのDock/Finderアイコンは、Web UI左上と同じFocusmapロゴを `desktop/focusmap-mac/assets/icon.icns` として使う。開発起動時は `desktop/focusmap-mac/assets/icon.png`、パッケージ版の起動中Dock表示は `Resources/icon.icns` を設定し、Finder表示と起動中表示でアイコンが切り替わらないようにする。Dockへの永続固定はユーザーのmacOS設定で、アプリ側は起動中に通常アプリとしてDockへ表示する。
- Macアプリの状態確認は `/api/desktop/health` を使い、重い `/dashboard` 初期化やAI/DB接続テストをヘルスチェックで走らせない。
- Macアプリ内でGoogle Calendar連携を開始した場合、Google OAuth画面はElectron内WebViewではなく既定ブラウザへ逃がす。ローカルに `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` がある場合は `/api/calendar/connect?desktop_oauth=1` でElectron内のSupabaseセッションを一時的にローカルメモリへ保持し、外部ブラウザから `/api/calendar/callback` に戻った時に同じユーザーのGoogleトークンを保存する。ローカルにGoogle OAuth設定がない場合は `https://focusmap-official.com/api/calendar/connect` を既定ブラウザで開き、ブラウザ側のFocusmap/GoogleログインCookieを使う。Google公式方針に合わせ、Google認証ページをElectron内に表示しない。
- MacアプリのFocusmapログインでGoogleを選んだ場合も、Googleアカウント選択/認証画面はElectron内WebViewではなく既定ブラウザへ逃がす。ログイン画面はElectron IPCで `FOCUSMAP_WEB_AUTH_ORIGIN`（既定 `https://focusmap-official.com`）を受け取り、外部ブラウザで `https://focusmap-official.com/auth/native-start?desktop=1&nonce=...` を開く。外部ブラウザ側でSupabase OAuthを開始し、PKCE code verifierも同じブラウザ側に保存する。`/auth/callback?desktop=1&nonce=...` は本番側の一時メモリにSupabaseセッションを保存し、Macアプリ側はElectronメインプロセス経由で本番 `/api/auth/desktop-session?nonce=...` をポーリングして `supabase.auth.setSession` する。ブラウザのCORSやローカル127.0.0.1のGoogle許可済みリダイレクト設定に依存しない。セッション受け渡しは5分TTLで、一般Webログインは従来通りブラウザ内リダイレクトを使う。
- Web UI上のGoogle Calendar接続ボタンは `src/lib/external-auth-launch.ts` の `startCalendarOAuth` を通す。MacアプリではElectronのナビゲーションハンドラが既定ブラウザへ逃がし、通常ブラウザでは従来通り `/api/calendar/connect` に遷移する。
- Macアプリから起動するNext.jsには、リポジトリの `.env` / `.env.local` と `~/.focusmap/desktop.env` を読み込ませる。`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` がない場合は、空の `client_id` でGoogleへ飛ばさず、Focusmap側の `calendar_error=google_oauth_not_configured` に戻す。
- Macアプリ/常駐runnerまわりの実行ログは、リポジトリ直下の `logs/` ではなく `~/.focusmap/logs/` に出す。即時Codex実行のstdout/stderrも同じディレクトリへ寄せ、リポジトリサイズに実行ログを混ぜない。
- Macアプリのメニューと「Focusmap 接続状態」ウィンドウから、既存 `scripts/focusmap-agent/dist/cli.js` と `scripts/run-codex-app-server.sh` を起動・停止・状態確認できる。agentの設定は従来通り `~/.focusmap/config.json` を使い、Macアプリ内にservice role key等は置かない。
- 開発中のMacアプリでは、`~/.focusmap/config.json` の `api_url` が本番APIを向いていても、agent起動時だけ `~/Library/Application Support/Focusmap/agent-config.json` に一時設定を作り、`api_url` を `http://127.0.0.1:3001/api` へ向ける。この場合、agent起動前に3001のNext APIも自動起動する。これにより本番Cloud Run側の環境変数に依存せず、ローカルNext API経由で `ai_tasks` を同期できる。配布版や本番API固定にしたい場合は `FOCUSMAP_DESKTOP_AGENT_API_URL` で明示する。
- Macアプリの通常導線ではCodex app-serverのWebSocket自動投入に依存しない。Electron側は `ANTHROPIC_API_KEY` / `CLAUDECODE` を外した環境で起動し、クリップボードコピー・Codex.app起動・ローカルsqlite/rollout同期を担う。`ws://127.0.0.1:7878` は既存runner互換やアーカイブ補助用途として残すが、ユーザー向けの確実な導線は手動ハンドオフを正とする。
- 配布用の最初の形は未署名の自分用ビルドでよい。`npm run mac:build` は古い `.next` / `dist-desktop/mac-arm64` を削除してから `next build` し、Nextの `react-loadable-manifest.json` に残る存在しない静的チャンク参照を補正・検査してから `dist-desktop/` へ arm64 の `.app` ディレクトリを作る。packaged app側の `next-standalone/.next` も同じ静的参照検査を通す。一般配布する場合はDeveloper ID署名・notarizationを別途追加する。
- Macアプリのパッケージングは `desktop/focusmap-mac` をElectron app directoryにし、rootの巨大な `node_modules` をアプリ本体へ入れない。Next standaloneは `extraResources/next-standalone` として同梱する。Nextの `outputFileTracingExcludes` では `mobile/**` / `.git/**` / `dist-desktop/**` を除外し、iOS Podsやビルド成果物がMacアプリへ混入しないようにする。

### Focusmap iPhoneアプリMVP

- iPhone版の初期実装は `mobile/focusmap-app` のExpo/React Nativeアプリを使う。既存Next.jsのモバイルUIを捨てず、React Native側は起動画面・読み込み状態・エラー復旧・ネイティブインストール枠を担当し、アプリ本体は `react-native-webview` で `/dashboard` を表示する。
- 標準の接続先は `https://focusmap-official.com/dashboard?source=ios-app&standalone=1`。スマホプレビューやローカル検証では、ビルド前に `EXPO_PUBLIC_FOCUSMAP_URL` でCloudflare tunnel等のURLへ差し替える。
- iPhone版WebViewの `pullToRefreshEnabled` は無効。画面全体をリロードするネイティブpull-to-refreshではなく、Web UI側の `Todo > 予定` ヘッダーpull更新でカレンダー同期だけを実行する。
- Apple Developer Programに入らない初期検証では、Xcodeの無料Personal Teamで実機へ直接インストールする。ホーム画面にはFocusmap専用アイコンが出るが、無料署名は7日で切れるため、継続利用には再インストールが必要。
- 実機インストールの入口は `mobile/focusmap-app/scripts/install-ios-free.sh`。Xcode本体がないMacでは実行を止め、`xcode-select` とライセンス承認の手順を表示する。`ios/` がない場合はExpo prebuildとPodsを再生成し、接続済みiPhoneを `xcrun devicectl` のJSON出力から検出する。実機ビルドは `xcodebuild -allowProvisioningUpdates -allowProvisioningDeviceRegistration` を使い、生成された `Focusmap.app` を `devicectl device install app` でiPhoneへ入れる。Expo CLI経由では無料Personal Teamのプロビジョニング自動生成オプションを渡せないため、実機インストールの標準導線は直Xcodeビルドにする。
- 無料Apple IDルートでは、XcodeのSigning & CapabilitiesでPersonal Teamを一度選ぶ必要がある。`security find-identity -v -p codesigning` にApple Development証明書がない場合、`install-ios-free.sh` は重いビルド前に止める。署名画面を開く入口は `npm run ios:signing` / `mobile/focusmap-app/scripts/open-ios-signing.sh`。初回起動で「信頼されていないデベロッパ」が出た場合は、iPhoneの `設定 > 一般 > VPNとデバイス管理` で開発元を信頼する。
- iPhoneアプリ内のGoogle認証はWebView内にGoogle画面を表示しない。`mobile/focusmap-app/App.tsx` が `accounts.google.com` / `oauth2.googleapis.com` / Supabase Auth URLを検出したらSafariへ開き、`focusmap://...` の戻りURLを受けてWebViewを更新する。
- iPhoneアプリ内のGoogleログインは、ログイン画面が `/auth/native-start?native_app=ios&nonce=...` をReact Native WebView bridgeから外部ブラウザーへ渡す。Supabase OAuth URLは外部ブラウザー側で生成し、PKCE code verifierも同じブラウザーに保存する。`/auth/callback?native_app=ios&nonce=...` は外部ブラウザー側でコード交換後に一時セッションを保存し、`focusmap://auth-complete?nonce=...` でアプリへ戻す。アプリは `/auth/native-bridge?nonce=...` をWebViewで開き、`/api/auth/desktop-session` から受け取ったSupabaseセッションを `supabase.auth.setSession` してから `/dashboard?source=ios-app&standalone=1` へ戻す。
- iPhoneアプリ内のGoogle Calendar連携は、WebView内で `/api/calendar/connect?app_oauth=ios` を開始し、サーバー側で現在のSupabaseセッションをOAuth stateに紐づけてからSafariへGoogle同意画面を開く。`/api/calendar/callback` はSafari側Cookieに依存せず保存済み一時セッションで `user_calendar_settings` にトークンを保存し、`focusmap://calendar-connected` でアプリへ戻す。

### Codexログ表示方針

- Focusmapに表示する主ログは、Codexの日本語/ユーザー向け返答本文を中心にする。
- `function_call` / `custom_tool_call` / `web_search_call` / `tool_search_call` などの内部コマンド開始ログは主ログへ混ぜない。
- Codex.app bridgeが観測した追加情報は `result.codex_sync_log` に保持し、通常のチャット表示とは分ける。
- `result.live_log` はチャットUIで表示できる本文、`result.codex_thread_snapshot` はCodex.app上のthread metadata、`codex_last_checked_at` はrunnerの同期間引き用。
- マインドマップの `CodexNodePanel` は送信後も閉じず、`ai_tasks` とローカルCodex状態を見ながら、プロンプト待ち/実行中/確認待ち、Codex出力、ユーザー追加入力、同期ログ、Codex.appで開くボタンを同じパネル内に表示する。

### 関連ファイル

| 領域 | ファイル |
|------|----------|
| Codex状態判定/rollout解析 | `src/lib/codex-run-state.ts` |
| Web側のai_tasks取得/更新間隔 | `src/hooks/useMemoAiTasks.ts` |
| マインドマップ表示/状態バッジ/手動更新 | `src/components/mindmap/custom-mind-map-view.tsx` |
| ダッシュボードからCodex状態を渡す層 | `src/components/dashboard/mind-map.tsx` |
| メモ編集パネル/Codex手動ハンドオフ | `src/components/codex/codex-node-panel.tsx` |
| Codex.app deep link生成/起動分岐 | `src/lib/codex-app-launch.ts` |
| Codex.app起動補助 | `src/app/api/codex/open-repo/route.ts` |
| ノードに紐づくCodex thread取得 | `src/app/api/codex/node-thread/route.ts` |
| Mac常駐runner/Codex同期 | `scripts/task-runner.ts` / `scripts/focusmap-agent/src/executors/codex-app.ts` |
| Focusmap Liteセットアップ | `scripts/install.sh` / `src/components/workspace/setup-step-agent.tsx` |
| Focusmap MacアプリMVP | `desktop/focusmap-mac/main.cjs` / `desktop/focusmap-mac/status.html` |
| Focusmap iPhoneアプリMVP | `mobile/focusmap-app/App.tsx` / `mobile/focusmap-app/scripts/install-ios-free.sh` |
| アプリ外部Google認証 | `src/lib/external-auth-launch.ts` / `src/app/auth/native-start/page.tsx` / `src/app/auth/native-bridge/page.tsx` / `src/app/api/calendar/connect/route.ts` |

---

## 主要なコンポーネント一覧

### Dashboard Components (8ファイル)
- `center-pane.tsx` (1,147行) - リストビュー
- `mind-map.tsx` (2,266行) - マインドマップビュー
- `left-sidebar.tsx` (118行) - 目的・プロジェクト選択
- `right-sidebar.tsx` (90行) - カレンダーパネル
- `sidebar-calendar.tsx` (160行) - カレンダー表示・操作
- `sidebar-calendar-header.tsx` (132行) - カレンダーヘッダー
- `calendar-settings.tsx` (165行) - カレンダー設定
- `mindmap-display-settings.tsx` (186行) - マインドマップ表示設定

### Calendar Components (11ファイル)
- `calendar-view.tsx` (148行) - ビューマネージャー
- `calendar-week-view.tsx` (275行) - 週ビュー
- `calendar-3day-view.tsx` (283行) - 3日ビュー
- `calendar-day-view.tsx` (182行) - 日ビュー
- `calendar-month-view.tsx` (133行) - 月ビュー
- `calendar-header.tsx` (159行) - ナビゲーション
- `calendar-selector.tsx` (258行) - カレンダー選択
- `calendar-event-card.tsx` (143行) - イベントカード
- `calendar-task-block.tsx` (139行) - タスクブロック
- `mini-calendar.tsx` (71行) - ミニカレンダー
- `calendar-toast.tsx` (76行) - トースト通知

### Task Components (4ファイル)
- `task-calendar-select.tsx` (135行) - カレンダー選択ドロップダウン
- `task-time-input.tsx` (166行) - 所要時間入力
- `task-calendar-sync-status.tsx` (59行) - 同期ステータス表示
- `index.ts` (1行)

---

## API エンドポイント一覧

### 認証
- `GET /api/auth/callback/google` - Google OAuth コールバック

### カレンダー連携
- `POST /api/calendar/connect` - カレンダー接続
- `GET /api/calendar/callback` - 認可コールバック
- `POST /api/calendar/disconnect` - カレンダー切断
- `GET /api/calendar/status` - 接続状態確認
- `GET /api/calendar/list` - カレンダーリスト取得
- `POST /api/calendar/sync-task` - タスク→カレンダー同期
- `PATCH /api/calendar/sync-task` - カレンダーイベント更新
- `DELETE /api/calendar/sync-task` - カレンダーイベント削除
- `GET /api/calendar/events/list` - イベント取得
- `GET /api/calendar/find-free-time` - 空き時間検索

### カレンダー管理
- `GET /api/calendars` - カレンダー一覧
- `PATCH /api/calendars/[id]` - カレンダー更新

### 通知
- `GET /api/notifications/permission` - 通知権限確認
- `GET /api/notifications/settings` - 通知設定取得
- `POST /api/notifications/settings` - 通知設定更新
- `POST /api/notifications/schedule` - 通知スケジュール
- `POST /api/notifications/initialize` - 通知初期化
- `POST /api/notifications/cancel` - 通知キャンセル

### タスク
- `POST /api/tasks/[id]/schedule` - タスクスケジュール
- `POST /api/tasks/[id]/time` - タスク時間更新

---

## データベース構成

### メインテーブル
- `tasks` - タスク（親子関係、カレンダー連携）
- `task_groups` - タスクグループ
- `projects` - プロジェクト
- `goals` - 目標

### カレンダー連携
- `user_calendar_settings` - Google Calendar 設定
- `calendar_sync_log` - 同期ログ

---

## 技術スタック
- **フロントエンド**: Next.js 16.1.3 (App Router), React 19
- **UI**: Radix UI, Tailwind CSS 4, Lucide Icons
- **バックエンド**: Supabase (PostgreSQL), Google Calendar API
- **認証**: NextAuth + Supabase SSR
- **マインドマップ**: ReactFlow, Dagre
- **カレンダー**: react-day-picker, カスタム実装
- **ドラッグ&ドロップ**: @hello-pangea/dnd, カスタム
- **通知**: Web Notifications API

---

## 実装済み機能
- ✅ ユーザー認証（Google OAuth + Supabase SSR）
- ✅ マインドマップ（ReactFlow）
- ✅ タスク管理（タイマー、優先度、見積もり時間）
- ✅ Google カレンダー連携（OAuth、イベント取得・同期・キャッシュ）
- ✅ 通知システム（Service Worker）
- ✅ カレンダーUI（日/週/月ビュー、ミニカレンダー、ダークモード）
- ✅ ダッシュボード（3ペイン構成）
- ✅ 設定ページ
- ✅ タスク入力自動フォーカス（新規作成時）

---

## 実装中
なし

---

## 次のアクション
→ `/next` で次のタスクを決定

---

最終更新: 2026-02-08
