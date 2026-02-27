# 🗺️ Shikumika App - Project Roadmap

## 📌 Product Vision
**「タスク管理とスケジュール管理を統合し、マインドマップで可視化する次世代プロダクティビティプラットフォーム」**

### Core Value
- 個人からエンタープライズまで対応
- 計画（マインドマップ）→ タスク化 → スケジュール配置を一つのプラットフォームで完結
- Googleカレンダー、Googleキープなど分散したツールを統合
- 優先順位と時間軸を可視化し、計画と実行のギャップを解消

---

## 🛠️ Tech Stack

| 領域 | 技術 | 備考 |
|------|------|------|
| **Frontend** | Next.js 16 (App Router) + React 19 | |
| **UI** | Radix UI + Tailwind CSS | アクセシビリティ対応 |
| **State Management** | React Context + Custom Hooks | |
| **Drag & Drop** | @hello-pangea/dnd | 軽量・高速 |
| **Date Handling** | date-fns | 軽量 |
| **Mind Map** | ReactFlow | 柔軟性高 |
| **Backend** | Next.js API Routes + Supabase | |
| **Database** | PostgreSQL (Supabase) | |
| **Auth** | Supabase Auth + Google OAuth | |
| **Real-time Sync** | Supabase Realtime + Google Calendar Webhook | |
| **External API** | Google Calendar API (googleapis) | |
| **Notifications** | Web Push API + Supabase Edge Functions | |

---

## 🎯 Phase 1: Googleカレンダー完全連携（MVP）

### 1.1 カレンダーイベントの双方向同期 🔄
**目的:** Googleカレンダーの予定を完全に取り込み、編集を双方向で反映

#### 1.1.1 イベント取得の実装 🔧（→ docs/plans/active/current.md）
- [x] Googleカレンダーからイベントをリアルタイム取得するAPI実装 ✅
- [x] `calendar_events`テーブルの作成・マイグレーション ✅
- [x] イベントデータをDBにキャッシュする処理 ✅
- [ ] 自動同期の動作確認・改善（クライアント polling 確認、トークンリフレッシュ確認）
- [ ] イベントキャッシュ整合性改善（削除検出、同期ステータス UI）
- [ ] Google Calendar Push Notifications（Webhook）→ Phase 2 以降に移動

#### 1.1.2 イベント表示の強化 ✅
- [x] 月ビューのレイアウト修正（セル高さ、テキストオーバーフロー対応）✅
- [x] 週ビューの UI 改善（グリッド線を border-border/10 → border-border/20）✅
- [x] 日ビューのレイアウト最適化（グリッド線改善）✅
- [x] イベントカードの見た目改善（ホバー状態を brightness-125 に変更）✅
- [x] 右サイドバー幅の見た目確認 ✅（後日微調整）

#### 1.1.3 イベント編集機能
- [ ] イベント詳細編集フォーム（タイトル、説明、時間）
- [ ] Google Calendar APIへの更新リクエスト
- [ ] オプティミスティックUI更新（即座に反映）
- [ ] イベント削除機能

#### 1.1.4 タスク→カレンダー自動連動 🔄（UI 完済み、バックエンド実装中）
**方針変更：** ドラッグ&ドロップを廃止し、タスク管理画面での設定のみで自動反映
- [x] タスク編集UIに「カレンダー設定パネル」を追加
  - カレンダー種別ドロップダウン（「登録なし」/Personal/Work/その他）
  - 実行開始時刻（HH:MM）
- [x] ビュー切替機能（月/週/3日/日）の実装
- [ ] タスク設定時の自動判定ロジック（Backend）⭐ 重要
  - カレンダー種別が「登録なし」以外で指定されている
  - 所要時間が5時間未満のみが対象
  - 実行予定日が設定されている
  - 上記3つを満たしたら、自動的にカレンダーイベントを生成
- [ ] Google Calendar APIへのイベント作成/更新（連携ロジック）
- [ ] 親タスク・子タスク関係なく、上記条件を満たしたら全部カレンダーに表示

---

### 1.2 カレンダーセレクター機能 📋
**目的:** 複数のGoogleカレンダーを管理し、表示/非表示を切り替え

#### 1.2.1 カレンダーリストの取得・表示
- [ ] Googleカレンダー一覧を取得するAPI実装
- [ ] `user_calendars`テーブルの作成・マイグレーション
- [ ] カレンダーリストをDBに保存
- [ ] 右サイドバーにカレンダーリストUIを実装
- [ ] カレンダーの色をGoogle側から取得

#### 1.2.2 表示/非表示の切り替え
- [ ] チェックボックスコンポーネントの実装
- [ ] チェック状態をローカルストレージに保存
- [ ] チェック状態をDBに永続化
- [ ] リアルタイムでカレンダー表示を更新
- [ ] 全選択/全解除機能

#### 1.2.3 カレンダーごとの色管理
- [ ] Googleカレンダーの色設定を取得
- [ ] カスタム色設定UI（カラーピッカー）
- [ ] 色設定の保存・適用

---

### 1.3 通知機能 🔔
**目的:** タスク開始時間や締切前にリマインダー

#### 1.3.1 ブラウザ通知
- [ ] Web Push API の権限リクエスト実装
- [ ] タスク開始時間の15分前に通知
- [ ] Googleカレンダーイベントの通知統合
- [ ] 通知クリック時の動作（該当タスク/イベントにジャンプ）

#### 1.3.2 通知設定UI
- [ ] 設定画面の作成
- [ ] 通知のON/OFF切り替え
- [ ] 通知タイミングの選択（5分前、15分前、30分前、1時間前）
- [ ] タスク種別ごとの通知設定

#### 1.3.3 (オプション) メール通知
- [ ] Supabase Edge Functionsの実装
- [ ] メールテンプレートの作成
- [ ] メール送信のスケジューリング

---

### 1.4 タスク-カレンダー連動機能（DB & Backend） 🔗
**目的:** タスク管理画面でシンプルに設定すると、自動的にカレンダーに反映

#### 1.4.1 DB スキーマの拡張
- [ ] `tasks`テーブルに`calendar_type`カラムを追加（TEXT, DEFAULT NULL）
- [ ] `tasks`テーブルに`scheduled_start_time`カラムを追加（TIME, DEFAULT NULL）
  - 既存の`scheduled_at`（TIMESTAMP）と併用
- [ ] `scheduled_at`（実行予定日）+ `scheduled_start_time`（開始時刻）で日時を決定

#### 1.4.2 API：タスク更新時の自動判定ロジック
- [ ] `POST /api/tasks/{id}/update` にて、タスク更新時に以下をチェック
  1. カレンダー種別が「登録なし」以外で指定されているか
  2. 所要時間チェック（estimated_time < 300分 = 5時間未満）
  3. 実行予定日が設定されているか
  4. 上記3つを満たす場合のみ、カレンダーイベント生成
- [ ] Google Calendar APIへのイベント作成（batch対応）
- [ ] イベント削除時の同期（カレンダー種別を「登録なし」に変更した場合など）
- [ ] 親タスク・子タスク関係なく対応

#### 1.4.3 UI：タスク管理パネルのカレンダー設定ドロップダウン
- [ ] タスク編集フォームに「カレンダー設定」セクション
  - カレンダー種別ドロップダウン（「登録なし」/Personal/Work/その他）
  - 実行開始時刻入力（HH:MM形式）
- [ ] バリデーション：所要時間 < 5時間のタスクのみ設定可能
- [ ] UI フィードバック：「カレンダー種別が設定されたので、カレンダーに自動反映されます」

---

## 🚀 Phase 2: 左サイドバー プロジェクト管理強化

### 2.1 プロジェクトステータス管理 📊
**目的:** プロジェクトの進行状況を可視化

#### 2.1.1 ステータス定義
- [ ] ステータスの定義（Not Started / In Progress / Blocked / Completed）
- [ ] `projects`テーブルに`status`カラムを追加
- [ ] カスタムステータス機能（エンタープライズ向け）
- [ ] ステータスごとの色設定

#### 2.1.2 ドラッグ&ドロップでステータス変更
- [ ] カンバンボードのようなUI実装
- [ ] ドラッグ&ドロップでステータス変更
- [ ] オプティミスティックUI更新
- [ ] ステータス変更履歴の記録

### 2.2 プロジェクト進捗の可視化 📈
- [ ] プログレスバー（タスク完了率）の表示
- [ ] 期限アラート機能
- [ ] タイムライン表示
- [ ] ガントチャート（オプション）

### 2.3 プロジェクトフィルタリング
- [ ] ステータスでフィルタリング
- [ ] 期限でソート
- [ ] 検索機能

---

## 🔮 Phase 3: 独自カレンダー開発（将来）

### 3.1 高度なタスク管理
- [ ] リカーリングタスク（繰り返しタスク）
- [ ] タスクの依存関係管理
- [ ] サブタスク機能

### 3.2 スマートスケジューリング
- [ ] タイムブロッキング機能
- [ ] AI による最適スケジュール提案
- [ ] 空き時間の自動検出・提案

### 3.3 コラボレーション機能（エンタープライズ）
- [ ] チームメンバーの招待
- [ ] プロジェクトの共有
- [ ] コメント・メンション機能
- [ ] リアルタイム共同編集

### 3.4 アナリティクス
- [ ] 時間の使い方分析
- [ ] 生産性レポート
- [ ] プロジェクト完了率ダッシュボード

---

## 📊 Database Schema（追加テーブル）

### calendar_events
Googleカレンダーイベントのキャッシュ

```sql
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  google_event_id TEXT UNIQUE NOT NULL,
  calendar_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  color TEXT,
  is_all_day BOOLEAN DEFAULT false,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  INDEX idx_user_id (user_id),
  INDEX idx_start_time (start_time),
  INDEX idx_calendar_id (calendar_id)
);
```

### user_calendars
ユーザーのカレンダー設定

```sql
CREATE TABLE user_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  google_calendar_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  background_color TEXT,
  is_visible BOOLEAN DEFAULT true,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, google_calendar_id),
  INDEX idx_user_id (user_id)
);
```

### tasks (既存テーブルに追加)
```sql
ALTER TABLE tasks
  ADD COLUMN calendar_type TEXT DEFAULT NULL,           -- カレンダー種別（Personal/Work/etc）
  ADD COLUMN scheduled_start_time TIME DEFAULT NULL;    -- 実行開始時刻（HH:MM）

-- 既存カラムで対応
-- - scheduled_at: TIMESTAMPTZ → 実行予定日時
-- - estimated_time: INTEGER → 所要時間（分単位）
-- - parent_task_id: UUID → 親タスク（リーフ判定に使用）
```

### notification_settings
通知設定

```sql
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  notification_type TEXT NOT NULL, -- 'task_start', 'task_due', 'event_start'
  is_enabled BOOLEAN DEFAULT true,
  advance_minutes INTEGER DEFAULT 15, -- 何分前に通知
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, notification_type)
);
```

---

## 🤖 AI基盤リニューアル（モデル非依存化 + スキル連動自動切替）

→ 詳細仕様: [specs/ai-provider-abstraction.md](docs/specs/ai-provider-abstraction.md)

### 概要
- AIProvider 抽象レイヤーで OpenAI / Anthropic / Gemini を切替可能に
- スキルごとに最適なモデルを自動選択（コスト効率と品質の両立）
- 2段階ルーティング（キーワード → LLM フォールバック）
- 壁打ち対話 + マインドマップ自動生成（ハイブリッド方式）

### 実装フェーズ
- [ ] Phase 1: AIProvider 抽象レイヤー + モデル切替テーブル
- [ ] Phase 2: 壁打ち対話の品質向上（プロンプト設計）
- [ ] Phase 3: 対話→マインドマップ自動変換
- [ ] Phase 4: 2段階ルーティング
- [ ] Phase 5: スキルUIパッケージ化

---

## 🎯 Current Sprint

### Status: AI基盤リニューアル Phase 1 準備中

**Next Action:**
- AIProvider 抽象レイヤーの実装計画を `NOW.md` に展開
- OpenAI / Anthropic API キーの取得

---

## 📝 Notes

- エンタープライズ対応は Phase 2 以降で段階的に実装
- パフォーマンス最適化は各フェーズ完了後にレビュー
- セキュリティ監査は Phase 1 完了時に実施
- ユーザーフィードバックを Phase 1 完了後に収集し、Phase 2 に反映
- AI基盤リニューアルは既存 Gemini 機能を壊さず段階移行する

---

**Last Updated:** 2026-02-27
