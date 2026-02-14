# しかみか (Shikumika) - ロードマップ

> マインドマップとタスク管理を統合し、Google カレンダーと連携した統合的なプロダクティビティアプリ

## 技術スタック
- **フロントエンド**: Next.js 16.1.3 (App Router), React 19
- **UI**: Radix UI, Tailwind CSS 4, Lucide Icons
- **バックエンド**: Supabase (PostgreSQL), Google Calendar API
- **認証**: NextAuth + Supabase SSR
- **その他**: ReactFlow (マインドマップ), react-day-picker (カレンダー)

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
  - 理由: 無料プランのスリープ制限（15分）とビルド問題
  - 決定: Vercelの無料プランを継続使用
  - 参考: [計画書](plans/features/render-deployment.md)

#### 機能拡張
- 🔧 **カレンダーイベント編集UI**（タップ→モダンな編集モーダル） → [計画](plans/features/calendar-event-edit-modal.md)
- ○ **プロジェクト管理CRUD**（左サイドバー: プロジェクト作成・切替・削除）
- ○ マインドマップのエクスポート/インポート
- ○ タスクのタグ付け機能
- ○ 統計・レポート機能

---

## 完了履歴
- 2026-02-13: **タスク削除時にGoogleカレンダー予定も自動削除** 完了
- 2026-02-13: **Cloud Run 本番デプロイ** 完了（https://shikumika-app-466617344999.asia-northeast1.run.app）
- 2026-02-12: **Cloud Run デプロイ対応** 完了
  - Dockerfile 作成（マルチステージビルド、standalone モード）
  - デプロイ自動化スクリプト（deploy-cloudrun.sh）
  - 環境変数テンプレート整備（.env.cloudrun）
  - デプロイ手順書作成（docs/DEPLOY_CLOUDRUN.md）
  - Vercel と並行運用可能な構成
- 2026-02-12: **カレンダードラッグ&ドロップ時間変更** 完了
  - イベント移動（開始時刻変更、15分スナップ）
  - 楽観的UI更新（ドロップ即反映 + 保存中スピナー）
  - ドラッグプレビュー改善（時刻リアルタイム表示、サイズ保持）
  - フォントサイズ最適化
- 2026-02-09: **Render.comデプロイ調査と環境変数整理**
  - Render.comへのデプロイ調査実施
  - 環境変数ファイルの整理（.env.example、.env.render）
  - ドキュメント更新（docs/.env.schema）
  - 結論: Vercel継続使用（無料プランのスリープ制限とビルド問題のため）
- 2026-02-08: **カレンダー同期機能の包括的な改善** 完了
  - 時間変更時の二重登録問題を修正（prevRef更新タイミングの改善）
  - カレンダー変更時のprevRef更新を追加
  - 同期ステータスのリセットタイミングを調整
  - useTaskCalendarSync.ts の状態管理を改善
- 2026-02-08: **タスク⇄Googleカレンダー自動同期** 完了
  - Phase 1: Google Calendar API の修正（通知設定・Extended Properties）
  - Phase 2: 自動同期 Hook (`useTaskCalendarSync`)
  - Phase 3: API エンドポイント（POST/PATCH/DELETE）
  - Phase 4: UI コンポーネント実装
  - データベースマイグレーション実施（tasks テーブルに calendar_id 等のカラム追加）
  - カレンダー変更時の二重予定問題修正（削除→作成の順に処理）
  - 404エラーの無限リトライ対策
- 2026-02-08: **データベース修正**
  - Supabase tasks テーブルに calendar_id, parent_task_id, order_index, timer カラム追加
  - user_calendar_settings, calendar_sync_log テーブル作成
- 2026-02-07: /refresh でプロジェクト再整理実施
- 2026-02-06: Gemini 3.0 Pro によるカレンダーUI実装完了（日/週/月ビュー、ミニカレンダー、重複イベント対応）
- 2026-02-06: プロジェクト整理・移行実施

---

## 現在進行中のタスク

なし
