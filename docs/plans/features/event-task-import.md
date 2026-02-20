---
feature: カレンダーイベント自動取り込み
type: feature
method: tdd
created: 2026-02-20
status: planning
---

# 設計プラン: カレンダーイベント自動取り込み

## 概要

Google カレンダーのイベントを自動的にタスクとして取り込み、タイマー・サブタスク・完了管理を統一的に使えるようにする。
カレンダーユーザーが自然にタスク管理に移行できる体験を提供。

## 要件

### コア機能
- Google カレンダーのイベントを `tasks` テーブルに自動取り込み
- 取り込み済みタスクでタイマー・サブタスク・チェックボックスが使える
- 差分同期（1日分ずつ追加、変更検出、ソフトデリート）
- 将来的に設定画面で取り込み範囲やカレンダーを調整可能

### 設計判断サマリー

| 判断項目 | 決定 |
|---------|------|
| 方式 | 自動取り込み（制限付き） |
| 取り込み範囲 | 7日先（設定で変更可能に） |
| Source of Truth | タイトル・時間=Google、タイマー・サブタスク・完了=アプリ |
| フィルタ | 全日イベント除外、キャンセル除外、非表示カレンダー除外 |
| 孤児管理 | ソフトデリート（30日保持、復元可能） |
| event_completions | 廃止（tasks.statusに統一） |
| 同期タイミング | 差分同期、1日分ずつ追加、同日スキップ |
| updated_at保護 | 直近5分以内に更新されたタスクは同期スキップ |

## リスク評価

| リスク | レベル | 対策 |
|--------|--------|------|
| 同期衝突（Google変更 vs アプリ変更） | MEDIUM | フィールドごとのSource of Truth分離 + updated_at保護 |
| タスク増殖（繰り返しイベント等） | LOW | フィルタリング + 7日制限 |
| パフォーマンス | LOW | 差分同期 + 既存キャッシュ活用 |
| event_completions移行 | LOW | Phase 2で段階的に移行 |
| DB容量 | NONE | 年間2,000行 ≈ 4MB（Supabase Free 500MBの0.8%） |

## 依存関係

- **ライブラリ**: 新規追加なし
- **外部サービス**: Google Calendar API（既存連携を活用）
- **DB変更**: tasks テーブルにカラム追加 + event_completions 廃止

## 実装フェーズ

### Phase 1: DB基盤 + 取り込みHook
> tasks テーブルの拡張と自動取り込みロジックの実装

- [x] tasks テーブルに `source` カラム追加（'manual' | 'google_event'、デフォルト: 'manual'）
- [x] tasks テーブルに `deleted_at` カラム追加（TIMESTAMPTZ、NULL許容）
- [x] tasks テーブルに `google_event_fingerprint` カラム追加（TEXT、変更検出用ハッシュ）
- [x] Supabase マイグレーション SQL 作成・適用
- [x] TypeScript 型定義更新（database.ts）
- [x] `useEventImport` Hook 作成:
  - 初回一括取り込み（7日分）
  - 差分同期（新規/更新/ソフトデリート）
  - `import_synced_at` によるスキップ判定
  - `updated_at` 保護（5分以内はスキップ）
  - フィルタリング（全日イベント除外等）
- [x] API: POST `/api/tasks/import-events` エンドポイント
- [x] テスト作成

### Phase 2: UI統合 + event_completions 移行
> 取り込み済みイベントをタスクとして今日ビューに統合

- [ ] today-view.tsx: 取り込み済みイベントをタスクとして表示（calendar_events → tasks に移行）
- [ ] 取り込み済みタスクの表示でも元のカレンダーカラーを保持
- [ ] event_completions の既存データを tasks.status に移行
- [ ] useEventCompletions Hook 廃止 → toggleTask に統一
- [ ] event_completions テーブル関連コード削除
- [ ] タイマー・サブタスクが取り込み済みタスクで動作確認
- [ ] テスト更新

### Phase 3: 設定画面 + クリーンアップ
> ユーザーが取り込み範囲を制御でき、古いデータが自動整理される

- [ ] 設定画面に「カレンダーイベント自動取り込み」セクション追加
  - ON/OFF トグル
  - 取り込み範囲（7日 / 14日 / 30日）
  - カレンダーごとの取り込みON/OFF
- [ ] ソフトデリートのクリーンアップ（30日超のレコード完全削除）
- [ ] 取り込み範囲外の古いタスク処理（ユーザーデータなし → 削除、あり → 保持）

## DB設計

### tasks テーブル変更

```sql
-- 新カラム追加
ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN google_event_fingerprint TEXT;

-- インデックス
CREATE INDEX idx_tasks_source ON tasks(source) WHERE source = 'google_event';
CREATE INDEX idx_tasks_deleted_at ON tasks(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_tasks_google_event_id ON tasks(google_event_id) WHERE google_event_id IS NOT NULL;
```

### google_event_fingerprint の計算

```typescript
function computeFingerprint(event: CalendarEvent): string {
  return `${event.title}|${event.start_time}|${event.end_time}|${event.calendar_id}`
}
```

→ フィンガープリントが変わった = イベントが変更された → タスクを更新

### ソフトデリートのクエリ影響

既存のクエリに `WHERE deleted_at IS NULL` を追加:
- tasks 取得: `SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL`
- RLS ポリシーに組み込むことも検討

## 同期フローの詳細

### 初回取り込み

```
1. useCalendarEvents で 7日分のイベント取得（既存キャッシュ活用）
2. フィルタリング: 全日イベント除外、非表示カレンダー除外
3. 既存タスク（source = 'google_event'）を google_event_id で取得
4. 差分計算:
   - Google にあり tasks にない → INSERT（新規タスク作成）
   - 両方にある → fingerprint 比較 → 変更あれば UPDATE
   - tasks にあり Google にない → SOFT DELETE
5. import_synced_at を更新
```

### 差分同期（日次）

```
1. import_synced_at が今日と同じ → スキップ
2. 取り込み範囲が1日シフト → 新しい1日分だけ処理
3. 既存日のイベントは fingerprint で変更チェック
4. updated_at が 5分以内のタスク → スキップ（ユーザー操作中）
```

### イベント → タスク変換マッピング

| CalendarEvent フィールド | Task フィールド | 備考 |
|---|---|---|
| title | title | Google が正 |
| start_time | scheduled_at | Google が正 |
| end_time - start_time | estimated_time（分） | Google が正 |
| google_event_id | google_event_id | リンクキー |
| calendar_id | calendar_id | Google が正 |
| — | source | 'google_event'（固定） |
| — | status | 'todo'（初期値） |
| — | stage | 'scheduled'（scheduled_at があるため） |
| — | is_timer_running | false（初期値） |
| — | total_elapsed_seconds | 0（初期値） |

## 実装対象ファイル

### 新規作成
| ファイル | 内容 |
|----------|------|
| `src/hooks/useEventImport.ts` | イベント取り込みHook |
| `src/app/api/tasks/import-events/route.ts` | 取り込みAPIエンドポイント |
| `supabase/migrations/YYYYMMDD_event_task_import.sql` | DB マイグレーション |

### 変更
| ファイル | 変更内容 |
|----------|----------|
| `src/types/database.ts` | source, deleted_at, google_event_fingerprint 型追加 |
| `src/components/today/today-view.tsx` | useEventImport 統合、event_completions 削除 |
| `src/components/today/today-timeline-calendar.tsx` | event_completions 依存削除 |
| `src/components/today/today-timeline-cards.tsx` | 同上 |
| `src/hooks/useCalendarEvents.ts` | 取り込み済みイベントの除外ロジック追加 |
| `src/hooks/useMindMapSync.ts` | deleted_at 対応（ソフトデリートされたタスクを除外） |

### 削除
| ファイル | 理由 |
|----------|------|
| `src/hooks/useEventCompletions.ts` | tasks.status に統一 |
| `src/app/api/event-completions/route.ts` | 同上 |

## 推奨実装方式
→ /tdd（DB変更 + 同期ロジックがあるため、テスト駆動推奨）
→ Phase 2 の UI部分は /impl でも可
