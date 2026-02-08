---
feature: タスク⇄Googleカレンダー自動同期
type: feature
method: tdd
created: 2026-02-08
status: planning
---

# 設計プラン: タスク⇄Googleカレンダー自動同期

## ROADMAP 上の位置づけ
**未実装 → 🔧 実装中**（ROADMAP.mdで「○」→「🔧」に変更）

既存の「タスクのカレンダーへの追加」（手動機能）を置き換えて、**自動同期機能**を実装します。

## 要件

### 機能要件
1. **自動作成条件**: タスクに以下の3つが揃った瞬間に自動作成
   - `scheduled_at` (開始時間)
   - `estimated_time` (所要時間)
   - `calendar_id` (カレンダー選択)

2. **双方向同期**:
   - タスク編集 → Googleカレンダーイベント更新
   - タスク削除 → Googleカレンダーイベント削除
   - カレンダー選択解除（`calendar_id` = null） → Googleカレンダーイベント削除

3. **イベント識別**: Google Calendar Extended Properties に `taskId` を保存

4. **通知**: 開始時刻ちょうど（0分前）に設定

### 非機能要件
- Google Calendar API レート制限対応（1秒あたり10リクエスト）
- エラー時のリトライロジック
- オフライン時のキューイング（Phase 2以降）

## リスク評価

- **MEDIUM**: Google Calendar API レート制限
  - 対策: リトライロジックとエラーハンドリング
- **MEDIUM**: ネットワークエラー時の同期失敗
  - 対策: エラー表示とリトライボタン
- **LOW**: Extended Properties の容量制限（16KB）
  - 対策: taskId のみ保存（数バイト）

## 依存関係

### 既存機能
- ✅ Google Calendar API 認証（`google-calendar.ts`）
- ✅ タスクテーブル（`calendar_id`, `google_event_id`, `scheduled_at`, `estimated_time`）
- ✅ `syncTaskToCalendar()` 関数（修正が必要）
- ✅ `deleteTaskFromCalendar()` 関数
- ✅ `user_calendars` テーブル

### 新規実装が必要
- タスク監視hook（`useTaskCalendarSync`）
- タスク編集UIのカレンダー選択ドロップダウン
- 同期状態表示UI

## 実装フェーズ

### Phase 1: Google Calendar API の修正（TDD推奨）
**所要時間**: 2-3時間

- [ ] `taskToCalendarEvent()` の修正
  - [ ] 通知設定を0分前に変更
  - [ ] Extended Properties に `taskId` を追加
  - [ ] テスト: `__tests__/lib/google-calendar.test.ts`

- [ ] `syncTaskToCalendar()` の修正
  - [ ] `task.target_calendar_id` → `task.calendar_id` に変更
  - [ ] Extended Properties を `events.insert()` に追加
  - [ ] Extended Properties を `events.update()` に追加
  - [ ] テスト: API呼び出しのモック

- [ ] `deleteTaskFromCalendar()` の修正
  - [ ] `calendar_id` パラメータを受け取るように変更
  - [ ] テスト: 削除APIのモック

**実装対象ファイル**:
- `/Users/kitamuranaohiro/Private/P dev/shikumika-app/src/lib/google-calendar.ts`
- `/Users/kitamuranaohiro/Private/P dev/shikumika-app/__tests__/lib/google-calendar.test.ts` (新規)

---

### Phase 2: 自動同期 Hook の実装（TDD推奨）
**所要時間**: 3-4時間

- [ ] `useTaskCalendarSync` hook を作成
  - [ ] タスクの3フィールド（`scheduled_at`, `estimated_time`, `calendar_id`）を監視
  - [ ] 3つ揃った瞬間に自動的に `POST /api/calendar/sync-task` を呼び出し
  - [ ] 編集検知時に `PATCH /api/calendar/sync-task` を呼び出し
  - [ ] `calendar_id` が null になったら `DELETE /api/calendar/sync-task` を呼び出し
  - [ ] 同期状態（idle, syncing, success, error）を管理
  - [ ] エラー時のリトライロジック（最大3回）
  - [ ] テスト: `__tests__/hooks/useTaskCalendarSync.test.ts`

**ロジック**:
```typescript
// 擬似コード
useEffect(() => {
  if (scheduled_at && estimated_time && calendar_id) {
    if (!google_event_id) {
      // 新規作成
      createEvent()
    } else {
      // 更新
      updateEvent()
    }
  } else if (!calendar_id && google_event_id) {
    // カレンダー選択解除 → 削除
    deleteEvent()
  }
}, [scheduled_at, estimated_time, calendar_id])
```

**実装対象ファイル**:
- `/Users/kitamuranaohiro/Private/P dev/shikumika-app/src/hooks/useTaskCalendarSync.ts` (新規)
- `/Users/kitamuranaohiro/Private/P dev/shikumika-app/__tests__/hooks/useTaskCalendarSync.test.ts` (新規)

---

### Phase 3: API エンドポイントの拡張（TDD推奨）
**所要時間**: 2-3時間

- [ ] `POST /api/calendar/sync-task` の修正
  - [ ] リクエストボディに `calendar_id` を追加
  - [ ] タスクの `calendar_id` を更新
  - [ ] Extended Properties を `syncTaskToCalendar()` に渡す
  - [ ] テスト: APIルートのテスト

- [ ] `PATCH /api/calendar/sync-task` の作成（新規）
  - [ ] 既存イベントの更新専用
  - [ ] タスクの変更を検知してGoogleカレンダーを更新
  - [ ] テスト: 更新APIのテスト

- [ ] `DELETE /api/calendar/sync-task` の作成（新規）
  - [ ] Googleカレンダーイベントを削除
  - [ ] タスクの `google_event_id` と `calendar_id` を null に設定
  - [ ] テスト: 削除APIのテスト

**実装対象ファイル**:
- `/Users/kitamuranaohiro/Private/P dev/shikumika-app/src/app/api/calendar/sync-task/route.ts` (修正)
- `/Users/kitamuranaohiro/Private/P dev/shikumika-app/__tests__/api/calendar/sync-task.test.ts` (新規)

---

### Phase 4: UI コンポーネントの実装（IMPL推奨）
**所要時間**: 2-3時間

- [x] タスク編集UIにカレンダー選択ドロップダウンを追加
  - [x] `user_calendars` から選択肢を取得
  - [x] カレンダー色を表示
  - [x] 「カレンダーに追加しない」オプションを追加

- [x] 同期状態表示
  - [x] 同期中: スピナー表示
  - [x] 同期済み: チェックマークアイコン
  - [x] エラー: エラーメッセージ + リトライボタン

**実装対象ファイル**:
- [x] `/Users/kitamuranaohiro/Private/P dev/shikumika-app/src/components/dashboard/center-pane.tsx` (修正)
- [x] `/Users/kitamuranaohiro/Private/P dev/shikumika-app/src/components/tasks/task-calendar-sync-status.tsx` (新規)
- [x] `/Users/kitamuranaohiro/Private/P dev/shikumika-app/src/components/tasks/task-calendar-select-fixed.tsx` (削除-不要)

---

### Phase 5: 統合テストと調整
**所要時間**: 1-2時間

- [ ] E2Eテスト
  - [ ] タスク作成 → 自動同期 → Googleカレンダー確認
  - [ ] タスク編集 → 自動更新 → Googleカレンダー確認
  - [ ] カレンダー選択解除 → 自動削除 → Googleカレンダー確認
  - [ ] タスク削除 → 自動削除 → Googleカレンダー確認

- [ ] エラーハンドリングテスト
  - [ ] ネットワークエラー時のリトライ
  - [ ] レート制限エラー時の遅延リトライ
  - [ ] 認証エラー時の再認証促進

## 実装対象ファイル（まとめ）

### 変更
- `src/lib/google-calendar.ts` - 通知・Extended Properties・calendar_id対応
- `src/app/api/calendar/sync-task/route.ts` - PATCH, DELETE追加

### 新規作成
- `src/hooks/useTaskCalendarSync.ts` - 自動同期hook
- `src/components/tasks/task-calendar-sync-status.tsx` - 同期状態表示
- `__tests__/lib/google-calendar.test.ts` - ユニットテスト
- `__tests__/hooks/useTaskCalendarSync.test.ts` - hookテスト
- `__tests__/api/calendar/sync-task.test.ts` - APIテスト

### UI修正
- `src/components/tasks/task-edit-form.tsx` - カレンダー選択ドロップダウン追加

## 推奨実装方式

**Phase 1-3: TDD（/tdd）** - ロジック・API・バリデーション
**Phase 4: IMPL（/impl）** - UI・スタイル

## 技術的な注意点

### Google Calendar API
```typescript
// Extended Properties の追加例
const event = {
  summary: task.title,
  start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Tokyo' },
  end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Tokyo' },
  reminders: {
    useDefault: false,
    overrides: [{ method: 'popup', minutes: 0 }] // 0分前
  },
  extendedProperties: {
    private: {
      taskId: taskId // これで紐付け
    }
  }
}
```

### タスク監視のロジック
```typescript
// 前回の値を保存
const prevRef = useRef({ scheduled_at, estimated_time, calendar_id, google_event_id })

useEffect(() => {
  const prev = prevRef.current
  const hasAllFields = scheduled_at && estimated_time && calendar_id
  const hadAllFields = prev.scheduled_at && prev.estimated_time && prev.calendar_id

  if (hasAllFields && !prev.google_event_id) {
    // 新規作成
    createEvent()
  } else if (hasAllFields && prev.google_event_id) {
    // 更新（いずれかのフィールドが変更された場合）
    if (/* any field changed */) {
      updateEvent()
    }
  } else if (!calendar_id && prev.google_event_id) {
    // カレンダー選択解除 → 削除
    deleteEvent()
  }

  prevRef.current = { scheduled_at, estimated_time, calendar_id, google_event_id }
}, [scheduled_at, estimated_time, calendar_id, google_event_id])
```

### エラーハンドリング
- `429 Too Many Requests` → 1秒待ってリトライ
- `401 Unauthorized` → 再認証促進
- `404 Not Found` → イベントが削除されている（DBのgoogle_event_idをクリア）
- その他 → 最大3回リトライ、失敗したらエラー表示

## 完了条件

- [x] タスクに3つのフィールドが揃ったら自動的にGoogleカレンダーにイベントが作成される
- [x] タスク編集時にGoogleカレンダーイベントが自動更新される
- [x] カレンダー選択解除時にGoogleカレンダーイベントが自動削除される
- [x] Extended Properties で taskId が保存され、紐付けが正しく動作する
- [x] 通知が開始時刻ちょうど（0分前）に設定される
- [x] エラー時にユーザーに適切なメッセージが表示される
- [x] すべてのテストがパスする
