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
| `useCalendarEvents` | Google Calendarイベント取得 | sidebar-calendar.tsx |
| `useCalendars` | ユーザーカレンダー一覧・選択管理 | calendar-selector.tsx |
| `useTimer` | タスクタイマー | center-pane.tsx |
| `useMemoAiTasks` | マインドマップ/メモ起点の最新 `ai_tasks` 状態を取得し、Codex状態バッジへ反映 | mind-map.tsx / mindmap-linked-memos-dialog.tsx |

---

## 現在の主要仕様

このセクションは、チャット履歴がなくても実装意図を復元できるようにするための現行仕様メモ。主要なUI・同期方式・データフローを変えた場合は、実装と同じコミットで更新する。

### ダッシュボードナビゲーション

- デスクトップ上部タブは `Todo` / `メモ` / `マップ` / `チャット` の順に表示する。
- モバイル下部ナビは `Todo` / `メモ` / `マップ` / `チャット` / `設定` の順に表示し、`チャット` を強調表示の対象にする。
- `Todo` タブの `メモ + カレンダー` サブビューは、サブビュータブ自体を見出しとして扱う。中央ペイン内に重複する「今日する」見出しや説明文は置かず、カラム切替・カレンダー選択・今日するメモ追加ボタンだけを薄いツールバーにまとめる。
- `Todo` タブ左側のメモカードは、`メモ` 画面と同じ `WishlistCardDetail` 編集シートを開く。見出し・本文・タグ・画像・予定化などのメモ編集導線は左ペインからも同じ挙動にする。

### マインドマップとCodex.app連携

- ノードからCodexへ渡す場合、Focusmapは作業本体を裏側で完結させるのではなく、Codex.app側を主軸にする。
- Focusmap側は `ai_tasks` に待機レコードを作り、プロンプトをクリップボードへコピーし、Codex.appのチャットを開く補助をする。
- マインドマップのメモ編集パネル（`CodexNodePanel`）では、「Codexに送る」から同じ手動ハンドオフを実行する。押下直後にメモ見出し本文とメモ詳細本文だけを改行区切りでクリップボードへコピーし、既存threadへの遷移は狙わず、Mac/デスクトップでは実体のある `codex://?prompt=...&path=...&originUrl=...` リンクとしてCodex.appを開く。スマホではブラウザURLではなく、iOS/iPadOSは `com.openai.chat://https://chatgpt.com/codex/mobile/`、Androidは `intent://chatgpt.com/codex/mobile/#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fcodex%2Fmobile%2F;end` を開き、ChatGPTアプリ側のCodex mobile入口を優先する。どちらもコピーと外部アプリ起動をクリック直後に開始し、保存や `ai_tasks` 登録の完了を待たない。
- オンラインのCodex対応runner（`executors` に `codex_app` または `codex` を含む2分以内heartbeat）がある場合だけ `ai_tasks` へ `dispatch_mode='auto'` のCodex.app実行を登録し、未接続なら手動ハンドオフとセットアップCTAに落とす。ブラウザが外部アプリ起動を止めても、Mac常駐runnerがpendingタスクを拾い、Codex app-serverへ送る。localhost と `*.trycloudflare.com` のスマホプレビューでは、デスクトップの場合だけローカルAPI `/api/codex/open-repo` からMacの `pbcopy`、`open codex://...`、Codex.appのactivateを実行し、スマホ判定時はChatGPT mobile入口を優先する。リポジトリ未設定時も手動ハンドオフに落とす。
- Codex.appの新規スレッド作成・リポジトリ選択・貼り付け済み送信は、OS/アプリ側の公開API制約により完全自動化できない前提。Focusmapは「プロンプト待ち」「実行中」「確認待ち」を表示して、状態確認とログ同期に徹する。
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
- 実行中・スレッド検出直後は体感優先で短い間隔で追う。launchdの通常起動に加え、実行中は5秒間隔の追加follow-upを最大2回入れる。
- Codex thread未検出の高速探索は開始後2分まで。2分を超えて見つからない場合は `monitoring_lost` として確認待ちにする。
- 確認待ち・手動貼り付け待ち・needs_inputは、頻繁に追わない。`result.codex_last_checked_at` を使い、通常は30分ごとの再確認に抑える。
- Focusmapで完了済みになったノードに紐づくCodex threadのアーカイブ/削除確認も、常時ではなく30分間隔の巡回に抑える。
- Web側の `useMemoAiTasks` は、実行中のCodexタスクがある場合だけ5秒更新。実行中がない場合は1時間更新に後退し、必要なら手動更新アイコンで即時取得する。

### Focusmap MacアプリMVP

- Mac版は、FocusmapのUIをSwiftUI等で作り直さない。既存のNext.js/React UIをElectronのBrowserWindow内で表示し、ブラウザではできないローカル機能だけをElectronメインプロセス側へ寄せる。
- 開発・自分用起動は `npm run mac:dev`。起動直後は軽量なローディング画面付きのメインウィンドウを先に開き、その後非同期で `http://127.0.0.1:3001/dashboard?desktop=1&source=mac` に遷移する。3001にFocusmapがいなければ、その時点で `next dev -p 3001` を自動起動し、待機中にユーザーへ画面を返す。ブラウザ版 `npm run dev` と分けるため、Macアプリ用には `npm run dev:desktop` を使う。
- MacアプリのDock/Finderアイコンは、Web UI左上と同じ丸いFocusmapロゴを `desktop/focusmap-mac/assets/icon.icns` として使う。開発起動時のDock表示にも同じ `icon.png` を設定する。Dockへの永続固定はユーザーのmacOS設定で、アプリ側は起動中に通常アプリとしてDockへ表示する。
- Macアプリの状態確認は `/api/desktop/health` を使い、重い `/dashboard` 初期化やAI/DB接続テストをヘルスチェックで走らせない。
- Macアプリのメニューと「Focusmap 接続状態」ウィンドウから、既存 `scripts/focusmap-agent/dist/cli.js` と `scripts/run-codex-app-server.sh` を起動・停止・状態確認できる。agentの設定は従来通り `~/.focusmap/config.json` を使い、Macアプリ内にservice role key等は置かない。
- 開発中のMacアプリでは、`~/.focusmap/config.json` の `api_url` が本番APIを向いていても、agent起動時だけ `~/Library/Application Support/Focusmap/agent-config.json` に一時設定を作り、`api_url` を `http://127.0.0.1:3001/api` へ向ける。この場合、agent起動前に3001のNext APIも自動起動する。これにより本番Cloud Run側の環境変数に依存せず、ローカルNext API経由で `ai_tasks` を同期できる。配布版や本番API固定にしたい場合は `FOCUSMAP_DESKTOP_AGENT_API_URL` で明示する。
- Codex app-serverは `ws://127.0.0.1:7878` のみを使う。Electron側も `ANTHROPIC_API_KEY` / `CLAUDECODE` を外した環境で起動し、既存のCodex.app連携安全策を維持する。
- 配布用の最初の形は未署名の自分用ビルドでよい。`npm run mac:build` は `next build` 後に `dist-desktop/` へ `.app` ディレクトリを作る。一般配布する場合はDeveloper ID署名・notarizationを別途追加する。

### Codexログ表示方針

- Focusmapに表示する主ログは、Codexの日本語/ユーザー向け返答本文を中心にする。
- `function_call` / `custom_tool_call` / `web_search_call` / `tool_search_call` などの内部コマンド開始ログは主ログへ混ぜない。
- Codex.app bridgeが観測した追加情報は `result.codex_sync_log` に保持し、通常のチャット表示とは分ける。
- `result.live_log` はチャットUIで表示できる本文、`result.codex_thread_snapshot` はCodex.app上のthread metadata、`codex_last_checked_at` はrunnerの同期間引き用。

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
