# しかみか (Shikumika) - プロジェクト全体像

> マインドマップとタスク管理を統合し、Google カレンダーと連携した統合的なプロダクティビティアプリ

最終更新: 2026-02-06

---

## 🎯 目的

タスク管理とマインドマップを統合し、Google カレンダーと連携した統合的なプロダクティビティアプリを提供する。

---

## 🏗️ 現在の機能

| 機能 | 状態 | メモ |
|------|------|------|
| マインドマップ | ✅ | ReactFlow によるノードベース実装 |
| タスク管理 | ✅ | TimerContext による時間管理 |
| Google カレンダー連携 | ✅ | API 実装済み、タスク同期可能 |
| 通知システム | ✅ | Service Worker 対応 |

---

## 📁 主要ファイル構成

### ページ
- `src/app/page.tsx` - トップページ
- `src/app/login/page.tsx` - ログインページ
- `src/app/dashboard/page.tsx` - ダッシュボードメイン
- `src/app/dashboard/settings/page.tsx` - 設定ページ

### コンポーネント
- `src/components/dashboard/mind-map.tsx` - マインドマップ本体
- `src/components/dashboard/left-sidebar.tsx` - 左サイドバー（ツリー）
- `src/components/dashboard/center-pane.tsx` - 中央ペイン
- `src/components/dashboard/right-sidebar.tsx` - 右サイドバー（プロパティ）
- `src/components/calendar/` - カレンダー関連コンポーネント
- `src/components/notifications/` - 通知関連コンポーネント
- `src/components/ui/` - Radix UI ベースのUIコンポーネント

### API Routes
- `src/app/api/auth/callback/google/route.ts` - Google認証コールバック
- `src/app/api/calendar/*` - カレンダー連携API
- `src/app/api/notifications/*` - 通知API

### Context & Hooks
- `src/contexts/TimerContext.tsx` - タイマー管理
- `src/contexts/DragContext.tsx` - ドラッグ&ドロップ管理
- `src/hooks/useCalendarEvents.ts` - カレンダーイベント取得
- `src/hooks/useTaskScheduling.ts` - タスクスケジューリング

### 型定義
- `src/types/database.ts` - データベース型
- `src/types/calendar.ts` - カレンダー関連型

---

## 🗄️ データベース

Supabase (PostgreSQL) 使用
- マイグレーション: `supabase/migrations/`

---

## 🤖 AIへの指示

新しいセッションの最初に、このファイルを読んでプロジェクト全体を理解してください。

詳細が知りたくなったら、以下を参照してください：
- 全体の進捗: `docs/ROADMAP.md`
- 現在のプラン: `docs/plans/active/`
- 完了した作業: `docs/summaries/`
