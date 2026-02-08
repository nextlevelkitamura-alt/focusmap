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
