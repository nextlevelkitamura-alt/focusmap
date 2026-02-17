---
feature: モバイル今日ビュー強化
type: feature
method: impl
created: 2026-02-17
status: planning
---

# 設計プラン: モバイル今日ビュー強化

## 要件

### 1. モバイルD&D時間変更
- カレンダータイムライン上のイベント/タスクをタッチドラッグで時間変更
- 下方向/上方向ドラッグ時に自動スクロール（画面端に近づくと自動的に追従）
- 15分刻みでスナップ
- ドロップ後、即座にGoogleカレンダーAPIと同期

### 2. タップ編集モーダル
- タップでPC同様の編集モーダルを表示（モバイル最適化）
- 編集項目: タスク名、カレンダー種別、所要時間、開始時間
- タスク → PATCH /api/tasks/[id]
- カレンダーイベント → Google Calendar API更新（既存の仕組み活用）

### 3. 全アイテムチェックボックス
- タスクだけでなくカレンダーイベントにもチェックボックスを表示
- チェック状態はDBに永続化（一定期間保存: 30日）

### 4. カレンダーイベント完了DB
- `event_completions` テーブル新設
- 習慣の `habit_completions` と同様のパターン
- 30日超の古いレコードは定期的に削除可能

## リスク評価

| リスク | レベル | 対策 |
|--------|--------|------|
| タッチD&Dのブラウザ互換性 | MEDIUM | Safari/Chrome両対応、touch-action CSS制御 |
| 自動スクロールの操作感 | MEDIUM | scrollSpeed可変、デッドゾーン設定 |
| D&D中の通常スクロールとの干渉 | HIGH | 長押し→ドラッグ起動（350ms）で区別 |
| Google Calendar API レート制限 | LOW | 既存のエラーハンドリングで対応済み |
| イベント完了DBの肥大化 | LOW | 30日保存 + 手動/定期クリーンアップ |

## 依存関係

- **ライブラリ**: 新規追加なし（ネイティブTouch API使用）
- **外部サービス**: Google Calendar API（既存連携を活用）
- **DB変更**: `event_completions` テーブル新設

## 実装フェーズ

### Phase 1: イベント完了DB + チェックボックス
> DB設計とチェックボックスUI。基盤となる部分

- [x] `event_completions` テーブル作成（Supabase SQL）
- [x] TypeScript型定義追加（`types/database.ts`）
- [x] API: POST/DELETE `/api/event-completions` エンドポイント
- [x] Hook: `useEventCompletions` 作成
- [x] UI: today-view タイムラインに全アイテムチェックボックス追加
- [x] UI: カレンダービュー（calendar mode）にもチェック状態を反映

### Phase 2: タップ編集モーダル
> タップで詳細編集できるモバイルUI

- [x] `MobileEventEditModal` コンポーネント作成
- [x] タスク編集: タスク名、開始時間、所要時間、カレンダー種別
- [x] イベント編集: イベント名、開始/終了時間
- [x] today-view のタイムラインアイテムにタップハンドラ追加
- [x] 既存API（PATCH /api/tasks/[id]）との接続
- [x] Googleカレンダーイベント更新との接続

### Phase 3: モバイルD&D時間変更
> タッチベースのドラッグ&ドロップ時間変更

- [x] `useTouchDrag` Hook 作成（タッチイベント管理）
- [x] 長押し判定（350ms）→ ドラッグモード開始
- [x] ドラッグ中のビジュアルフィードバック（半透明 + 時刻プレビュー）
- [x] 自動スクロール実装（上下端60px以内で発動、速度可変）
- [x] 15分刻みスナップ計算
- [x] ドロップ後のAPI更新（タスク: PATCH、イベント: Google Calendar API）
- [x] ドロップ後の即時Google Calendar同期

## DB設計: event_completions テーブル

```sql
CREATE TABLE event_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  google_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  completed_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, google_event_id, completed_date)
);

CREATE INDEX idx_event_completions_user_date
  ON event_completions(user_id, completed_date);

ALTER TABLE event_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own event completions"
  ON event_completions FOR ALL
  USING (auth.uid() = user_id);
```

**設計判断**:
- `google_event_id` で識別（DBのevent IDではなくGoogleのIDを使用、calendar_eventsテーブルはキャッシュであり永続的ではないため）
- `completed_date` で日次管理（繰り返しイベントも日ごとに完了管理可能）
- 30日超の古いレコードは定期クリーンアップ対象

## TypeScript型定義

```typescript
export interface EventCompletion {
  id: string
  user_id: string
  google_event_id: string
  calendar_id: string
  completed_date: string  // YYYY-MM-DD
  created_at: string
}
```

## 実装対象ファイル

### 新規作成
| ファイル | 内容 |
|----------|------|
| `src/hooks/useEventCompletions.ts` | イベント完了状態の管理Hook |
| `src/app/api/event-completions/route.ts` | 完了トグルAPI |
| `src/components/today/mobile-event-edit-modal.tsx` | モバイル編集モーダル |
| `src/hooks/useTouchDrag.ts` | タッチD&D管理Hook |

### 変更
| ファイル | 変更内容 |
|----------|----------|
| `src/types/database.ts` | EventCompletion型追加 |
| `src/components/today/today-timeline-calendar.tsx` | チェックボックス追加、タップ編集、D&D対応 |
| `src/components/today/today-timeline-cards.tsx` | チェックボックス追加、タップ編集 |
| `src/components/today/today-view.tsx` | useEventCompletions統合、モーダル管理 |

## 推奨実装方式
→ /impl（UI中心の実装が多いため）
→ Phase 1のAPI/DB部分のみ /tdd を検討
