# しかみか (Shikumika) - ロードマップ

> マインドマップとタスク管理を統合し、Google カレンダーと連携した統合的なプロダクティビティアプリ

## 技術スタック
- **フロントエンド**: Next.js 16.1.3 (App Router), React 19
- **UI**: Radix UI, Tailwind CSS 4, Lucide Icons
- **バックエンド**: Supabase (PostgreSQL), Google Calendar API
- **認証**: NextAuth + Supabase SSR
- **その他**: ReactFlow (マインドマップ), react-day-picker (カレンダー)

---

## 開発時の参照先と注意点

### カレンダー連携（修正頻度高）

**データフロー**: DB → useMindMapSync → mind-map.tsx(TaskNode data) → TaskCalendarSelect / DateTimePicker → useTaskCalendarSync → API

| レイヤー | ファイル | 注意点 |
|---|---|---|
| DB スキーマ | `src/types/database.ts` | `tasks.calendar_id`（`google_calendar_id`ではない） |
| 型定義（マインドマップ） | `src/components/dashboard/mind-map.tsx` 内 `parsedTasks` | JSON.parse時の型にcalendar_idを含めること |
| データ同期 | `src/hooks/useMindMapSync.ts` | updateTaskはoptimistic update + Supabase直接更新 |
| カレンダー同期 | `src/hooks/useTaskCalendarSync.ts` | `scheduled_at` + `estimated_time` + `calendar_id` の3つが揃った時のみ同期発火 |
| 同期API | `src/app/api/calendar/sync-task/route.ts` | POST(新規)/PATCH(更新)/DELETE(削除) |
| カレンダーリスト | `src/hooks/useCalendars.ts` → `src/app/api/calendars/route.ts` | `user_calendars.google_calendar_id` がカレンダー識別子 |
| UI: カレンダー選択 | `src/components/tasks/task-calendar-select.tsx` | valueは`google_calendar_id`形式（メールアドレス等） |
| UI: 日時選択 | `src/components/ui/date-time-picker.tsx` | propsは `date` + `setDate`（`value`/`onChange`ではない） |

### フィールド名の対応表

| 場所 | フィールド名 | 値の例 |
|---|---|---|
| `tasks` テーブル | `calendar_id` | `"nextlevel.kitamura@gmail.com"` |
| `user_calendars` テーブル | `google_calendar_id` | `"nextlevel.kitamura@gmail.com"` |
| `task_groups` テーブル | ※廃止予定（tasksに統合済み） | — |
| `calendar_events` テーブル | `calendar_id` | `"nextlevel.kitamura@gmail.com"` |

### マインドマップ（ReactFlow）

| ファイル | 役割 |
|---|---|
| `src/components/dashboard/mind-map.tsx` | ノード定義(ProjectNode/TaskNode) + レイアウト計算 |
| `src/components/dashboard/center-pane.tsx` | マインドマップ + タスクリスト表示、useTaskCalendarSync使用箇所 |
| `src/hooks/useMindMapSync.ts` | DB同期（CRUD操作） |

**注意**: ReactFlowのnodeTypesはコンポーネント外で定義すること（再レンダリング防止）
**注意**: GroupNodeは廃止済み。全ノードをTaskNodeで統一。ルートタスク = `parent_task_id === null`

---

## 現在のフェーズ: Phase 1 - 開発中

## 機能一覧

### 実装済み
- ✅ **ユーザー認証** → [CONTEXT.md](docs/CONTEXT.md#技術スタック)
  - Google OAuth 連携
  - Supabase SSR 認証
  - ミドルウェアによるルート保護
- ✅ **マインドマップ** → [CONTEXT.md](docs/CONTEXT.md#中央ペイン-centerpane)
  - ReactFlow によるノードベースのマインドマップ
  - ドラッグ＆ドロップ対応
  - マインドマップとタスクの双方向同期
- ✅ **タスク管理** → [CONTEXT.md](docs/CONTEXT.md#中央ペイン-centerpane)
  - タスクの作成・編集・削除
  - タイマー機能
  - 優先度設定
  - 見積もり時間管理
- ✅ **Google カレンダー連携** → [CONTEXT.md](docs/CONTEXT.md#api-エンドポイント一覧)
  - カレンダー連携・解除
  - 複数カレンダー対応
  - イベント同期
  - 空き時間検索
- ✅ **通知システム** → [CONTEXT.md](docs/CONTEXT.md#api-エンドポイント一覧)
  - ブラウザ通知権限管理
  - 通知スケジューリング
  - Service Worker 対応
- ✅ **本格的カレンダーUI（Googleカレンダー風）** → [CONTEXT.md](docs/CONTEXT.md#右サイドバー-rightsidebar)
  - Googleカレンダー風のデザイン・色合い
  - ドラッグ&ドロップで予定の移動・時間変更
  - リアルタイムでGoogleアカウントと同期
  - 複数カレンダーの切り替え表示
  - 週ビュー、月ビュー、日ビュー
  - カレンダー選択・表示切り替え
  - ミニカレンダー
  - ダークモード対応
  - イベント重複表示（重なり対応）
- ✅ **ダッシュボード** → [CONTEXT.md](docs/CONTEXT.md#ダッシュボード構成3ペイン)
  - 左サイドバー（ツリー表示）
  - 中央ペイン（マインドマップ）
  - 右サイドバー（プロパティ）
- ✅ **設定ページ** → [CONTEXT.md](docs/CONTEXT.md#主要なコンポーネント一覧)
  - カレンダー設定
  - 通知設定

### 未実装

#### インフラ・デプロイ
- ✅ **Cloud Run デプロイ対応**（Vercel と並行運用） → [手順書](DEPLOY_CLOUDRUN.md)
  - Dockerfile、デプロイスクリプト作成
  - standalone モード設定
  - 環境変数テンプレート整備
- ❌ **Renderへのデプロイ対応** → キャンセル（Vercel継続使用）

#### 機能拡張
- ✅ **カレンダーイベント編集UI**（タップ→モダンな編集モーダル）
- 🔧 **グループとタスクの統合**（task_groupsをtasksに統合、GroupNode廃止） → [引き継ぎ](plans/features/group-task-unification-handover.md)
  - Phase 1: DB移行 ✅ | Phase 2: コード変更 ✅ | Phase 3: 旧テーブル削除 ○
- 🔧 **マインドマップ操作感改善**（XMind風の操作体系） → [計画](plans/features/mindmap-ux-improvement.md)
- 🔧 **スペース機能 + 左サイドバー再設計**（Goal→Space移行、プロジェクトCRUD、カレンダー紐付け） → [計画](plans/features/space-sidebar-redesign.md)
- ○ マインドマップのエクスポート/インポート
- ○ タスクのタグ付け機能
- ○ 統計・レポート機能

---

## 完了履歴

- 2026-02-16: **グループとタスクの統合 Phase 1-2** 完了（GroupNode廃止、全ノードTaskNode化）
- 2026-02-15: **カレンダーイベント編集UI** 完了
- 2026-02-13: **タスク削除時にGoogleカレンダー予定も自動削除** 完了
- 2026-02-13: **Cloud Run 本番デプロイ** 完了
- 2026-02-12: **Cloud Run デプロイ対応** 完了
- 2026-02-12: **カレンダードラッグ&ドロップ時間変更** 完了
- 2026-02-08: **タスク⇄Googleカレンダー自動同期** 完了
- 2026-02-06: **Googleカレンダー風UI** 完了（日/週/月ビュー、ミニカレンダー、重複イベント対応）

---

## 現在進行中のタスク

- 🔧 **グループとタスクの統合** → [引き継ぎ](plans/features/group-task-unification-handover.md)
  - Phase 1-2 完了（GroupNode廃止、全ノードTaskNode化、ビルド成功）
  - **Phase 3 未着手**: 旧テーブル（task_groups）削除
- 🔧 マインドマップ操作感改善（XMind風） → [計画](plans/features/mindmap-ux-improvement.md)
- 🔧 スペース機能 + 左サイドバー再設計 → [計画](plans/features/space-sidebar-redesign.md)
