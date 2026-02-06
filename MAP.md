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

#### 1.1.1 イベント取得の実装
- [ ] Googleカレンダーからイベントをリアルタイム取得するAPI実装
- [ ] `calendar_events`テーブルの作成・マイグレーション
- [ ] イベントデータをDBにキャッシュする処理
- [ ] 5分間隔での自動同期処理（Next.js API Routes + Cron）
- [ ] Google Calendar Push Notifications（Webhook）の実装準備

#### 1.1.2 イベント表示の強化
- [ ] 週ビューにGoogleカレンダーイベントを表示
- [ ] 月ビューにGoogleカレンダーイベントを表示
- [ ] イベントの色分け（カレンダーごと）
- [ ] タイムゾーン対応
- [ ] イベント詳細のポップオーバー表示

#### 1.1.3 イベント編集機能
- [ ] ドラッグ&ドロップでイベントの日時を変更
- [ ] Google Calendar APIへの更新リクエスト
- [ ] オプティミスティックUI更新（即座に反映）
- [ ] イベント詳細編集フォーム（タイトル、説明、時間）
- [ ] イベント削除機能

#### 1.1.4 イベント作成機能
- [ ] カレンダー上で新規イベントを作成（ダブルクリック or ボタン）
- [ ] Google Calendar APIへの作成リクエスト
- [ ] タスクからイベントへの変換（ドラッグ&ドロップ）
- [ ] 繰り返しイベントの基本対応

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

### 1.4 タスク所要時間管理 ⏱️
**目的:** タスクに所要時間を設定し、カレンダー上で時間を確保

#### 1.4.1 タスクに時間属性を追加
- [ ] `tasks`テーブルに`estimated_duration`カラムを追加（分単位）
- [ ] タスク編集UIに時間入力欄を追加
- [ ] 時間のフォーマット表示（1h 30m など）

#### 1.4.2 カレンダーへのドラッグ時に時間を反映
- [ ] タスクをカレンダーにドロップ → 所要時間分のイベントを作成
- [ ] 空き時間の自動検出アルゴリズム
- [ ] 開始時間の自動調整
- [ ] Google Calendar APIへのイベント作成

#### 1.4.3 時間の可視化
- [ ] 週ビューでタスクの時間を視覚的に表示
- [ ] 日ビューでタスクの時間を詳細表示
- [ ] 重複チェック機能
- [ ] オーバーブッキング警告

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
  ADD COLUMN estimated_duration INTEGER, -- 分単位
  ADD COLUMN actual_duration INTEGER,    -- 実績時間
  ADD COLUMN calendar_event_id UUID REFERENCES calendar_events(id);
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

## 🎯 Current Sprint

### Status: Phase 1 開始準備中

**Next Action:**
- Phase 1.1.1（イベント取得の実装）のタスク詳細化
- NOW.mdの作成

---

## 📝 Notes

- エンタープライズ対応は Phase 2 以降で段階的に実装
- パフォーマンス最適化は各フェーズ完了後にレビュー
- セキュリティ監査は Phase 1 完了時に実施
- ユーザーフィードバックを Phase 1 完了後に収集し、Phase 2 に反映

---

**Last Updated:** 2026-01-28
