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

#### 品質基盤（2〜3年後の成長に備えた基盤整備）
- 🔥 **テスト基盤整備** → [計画](plans/features/quality-improvement.md)
  - Phase 1: E2Eテスト導入（Playwright）○
    - ログイン、タスク作成、カレンダー同期、タイマー、設定の5フロー
  - Phase 1: Unitテスト導入（Vitest）○
    - useMindMapSync、useTaskCalendarSync、useCalendarEvents の主要3 Hooks
  - 目標カバレッジ: 60%以上
- 🔥 **CI/CD強化** → [計画](plans/features/quality-improvement.md)
  - Phase 2: GitHub Actions パイプライン構築 ○
    - Lint + Type Check → Unit Test → E2E Test → Build → Deploy
  - PRマージ前の自動テスト強制実行
- ⚡ **エラーハンドリング統一** → [計画](plans/features/quality-improvement.md)
  - Phase 3: 共通エラーハンドラー導入 ○
  - 全APIルート（28ファイル）+ 全Hooks（16ファイル）に適用
  - エラーログ構造化、ユーザーメッセージ統一
- ⚡ **巨大コンポーネント分割** → [計画](plans/features/quality-improvement.md)
  - Phase 4: mind-map.tsx（2,328行）を10ファイルに分割 ○
  - レイアウトロジック、ノードコンポーネント、Hooks の責務分離

#### 機能拡張
- ❌ **AIメモ機能**（廃止） → AIエージェントシステムに統合・置き換え
- 🔧 **AI Agent System**（コンテキスト記憶・Skills・メモ廃止・透明性UI） → [仕様](specs/ai-agent-system.md) | [計画](plans/features/ai-agent-system.md)
  - Phase 1: ai_project_context テーブル（DB基盤） ○
  - Phase 2: コンテキストインタビューAPI + 要約保存 ○
  - Phase 3: 設定画面にコンテキスト表示・更新UI ○
  - Phase 4: Skills ファイル構成 + ルーター実装 ○
  - Phase 5: チャットAPIへのコンテキスト注入 + スキル実行 ○
  - Phase 6: メモ機能廃止（UI削除・DB廃止・BottomNav変更） ○
- 🔥 **AI基盤リニューアル**（モデル非依存化・スキル連動自動切替・壁打ち強化） → [仕様](specs/ai-provider-abstraction.md)
  - Phase 1: AIProvider抽象レイヤー + モデル切替テーブル ○
  - Phase 2: 壁打ち対話の品質向上（プロンプト設計） ○
  - Phase 3: 対話→マインドマップ自動変換（ハイブリッド方式） ○
  - Phase 4: 2段階ルーティング（LLM + キーワードフォールバック） ○
  - Phase 5: マルチプロバイダー有効化 + スキルUI ○
- 🔥 **AIコンテキスト フォルダ管理**（フォルダ/ファイル型UIでコンテキスト管理・鮮度管理・自動要約） → [仕様](specs/ai-context-folder-management.md)
  - Phase 1: データ基盤（ai_context_folders / ai_context_documents テーブル + 初期化API） ○
  - Phase 2: CRUD API（フォルダ・ドキュメント操作 + ツリー取得 + 鮮度サマリー） ○
  - Phase 3: UI実装（フォルダツリー・ドキュメントエディタ・鮮度バッジ・モバイル対応） ○
  - Phase 4: AI統合（コンテキスト注入改修・鮮度アラート・context_update新形式） ○
  - Phase 5: 磨き込み（オンボーディング・AI自動更新承認・旧テーブル移行） ○
- ✅ **カレンダーイベント編集UI**（タップ→モダンな編集モーダル）
- ✅ **マインドマップ操作感改善**（ドラッグ閾値、キーボード操作、XMind風）
- ✅ **グループとタスクの統合**（task_groupsをtasksに統合、GroupNode廃止） → [引き継ぎ](plans/features/group-task-unification-handover.md)
  - Phase 1: DB移行 ✅ | Phase 2: コード変更 ✅ | Phase 3: 旧テーブル削除 ✅
- ❌ **スペース機能 + 左サイドバー再設計** → 中止（計画書は保持: [計画](plans/features/space-sidebar-redesign.md)）
- ✅ **習慣機能強化 + モバイルUI改善**（習慣DB、API、習慣ビュー、PC版統合） → [計画](plans/features/mobile-ui-redesign.md)
- ✅ **モバイル今日ビュー強化**（D&D時間変更、タップ編集、チェックボックス、イベント完了DB） → [仕様](specs/mobile-today-view-enhancement.md) | [計画](plans/features/mobile-today-view-enhancement.md)
- ✅ **クイックタスク追加 + サブタスク追加**（FABボタン、プロジェクト選択、カレンダー横+ボタン、チェックリスト） → [計画](plans/features/quick-task-add.md)
  - Phase 1: FABボタン + タスク追加モーダル ✅
  - Phase 2: サブタスク追加 + チェックリスト表示 ✅
- ✅ **カレンダーイベント自動取り込み**（イベント→タスク化、タイマー・サブタスク統合、差分同期、1ヶ月自動取り込み） → [仕様](specs/event-task-import.md)
  - Phase 1: DB基盤 + 取り込みHook ✅
  - Phase 2: UI統合 + event_completions廃止 ✅
  - Phase 3: 設定画面 + クリーンアップ ○
- ✅ **設定画面リデザイン**（カレンダー設定拡張、自動取り込み制御、ダークモード、アカウント管理） → [計画](plans/features/settings-redesign.md)
  - Phase 1: UI構築（モバイル） ✅
  - Phase 2: カレンダー設定実装 ✅
  - Phase 3: アカウント機能実装 ✅
  - Phase 4: PC統合 ✅
- 🔧 **習慣機能改善**（日次完了リセット・TODOビュー統合・週間達成率UI） → [仕様](specs/habit-daily-reset.md) | [計画](plans/features/habit-daily-reset.md)
- ○ マインドマップのエクスポート/インポート
- ○ タスクのタグ付け機能
- ○ 統計・レポート機能

---

## 完了履歴

- 2026-02-26: **AIメモ機能 廃止** → AI Agent System に統合（メモ概念をAIチャットに吸収）
- 2026-02-21: **AIメモ Phase 5b** 完了（選択肢ボタンUI、optionsパース、タップで自動送信）
- 2026-02-21: **AIメモ Phase 5a + 波形アニメーション + 削除UI** 完了（AIチャット対話、VoiceWaveform共有化、確認付き削除）
- 2026-02-23: **タスク削除の即時反映修正** 完了（削除ボタン押下時にGoogleカレンダーイベントもUIから即座に削除する楽観的UI更新）
- 2026-02-21: **AIメモ機能 Phase 1,2,4,6** 完了（メモUI・AI分析・音声入力・タスクメモ欄・プロジェクト紐付け）
- 2026-02-21: **スペース機能 + 左サイドバー再設計** 中止（計画書保持）
- 2026-02-20: **カレンダーイベント自動取り込み Phase 1-2** 完了 (C, /tdd+/impl, DB基盤+UI統合+event_completions廃止+1ヶ月取り込み)
- 2026-02-19: **tasks/route・tasks/[id]/route テスト追加** 完了 (C, /test, 25テスト追加 → 計203テスト)
- 2026-02-19: **event-completions・habits・habits/completions route テスト追加** 完了 (C, /test, 41テスト追加 → 計178テスト)
- 2026-02-19: **sync-task/route テスト追加** 完了 (C, /test, 28テスト追加 → 計137テスト)
- 2026-02-19: **useCalendars / useHabits / useEventCompletions / useMultiTaskCalendarSync テスト追加** 完了 (C, /test, 47テスト追加 → 計109テスト)
- 2026-02-18: **API エラーハンドリング強化** 完了 (C, /quality error-handling, 4ファイル7ハンドラ)
- 2026-02-18: **projects API テスト追加** 完了 (C, /test, 12テスト Pass)
- 2026-02-18: **useCalendarEvents.ts テスト追加** 完了 (C, /test, 11テスト Pass)
- 2026-02-18: **useTaskCalendarSync.ts テスト追加** 完了 (C, /test, 13テスト Pass)
- 2026-02-18: **useMindMapSync.ts テスト追加** 完了 (C, /test, 25テスト Pass)
- 2026-02-17: **今日ビュー習慣バー強化 (Phase 6)** 完了（モックデータ→useHabits Hook、週間ドット実データ、子タスクチェックボックス）
- 2026-02-17: **習慣API + Hook (Phase 5)** 完了（habit_completions テーブル、API、useHabits Hook、ストリーク計算）
- 2026-02-17: **PC版習慣ビュー + ヘッダータブ** 完了（habits-view.tsx、ヘッダーにマップ/習慣タブ）
- 2026-02-17: **習慣トグル・設定UIの修正** 完了（groupsJson修正、saveRefパターン、Popover安定化、コンパクトUI）
- 2026-02-17: **マインドマップ操作感改善** 完了（ドラッグ閾値15px、Returnキー修正）
- 2026-02-17: **習慣機能強化 Phase 2-4** 完了（未スケジュールタスク削除、習慣DB、マインドマップ習慣UI）
- 2026-02-16: **グループとタスクの統合 Phase 1-2** 完了（GroupNode廃止、全ノードTaskNode化）
- 2026-02-15: **カレンダーイベント編集UI** 完了
- 2026-02-13: **Cloud Run 本番デプロイ** 完了
- 2026-02-08: **タスク⇄Googleカレンダー自動同期** 完了
- 2026-02-06: **Googleカレンダー風UI** 完了

---

## 現在進行中のタスク

- 🔥 **AIコンテキスト フォルダ管理**（フォルダ/ファイル型UIでコンテキスト管理・鮮度管理・自動要約） → [仕様](specs/ai-context-folder-management.md)
- 🔧 **AI Agent System**（コンテキスト記憶・Skills・メモ廃止・透明性UI） → [仕様](specs/ai-agent-system.md) | [計画](plans/features/ai-agent-system.md)
- 🔥 **AI基盤リニューアル**（モデル非依存化・スキル連動自動切替・壁打ち強化） → [仕様](specs/ai-provider-abstraction.md)
- 🔧 **習慣機能改善**（日次完了リセット・TODOビュー統合・週間達成率UI） → [仕様](specs/habit-daily-reset.md) | [計画](plans/features/habit-daily-reset.md)
