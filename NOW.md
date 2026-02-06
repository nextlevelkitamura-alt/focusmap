# NOW - 現在取り組んでいること

## 🎯 Phase 1.2: マルチカレンダー対応（実装完了）

### 目的
全てのGoogleカレンダー（共有・チームカレンダー含む）を取得し、カレンダーセレクターから表示/非表示を切り替えられるようにする。

### 実装完了項目 ✅
- [x] データベース設計とマイグレーション作成
- [x] 型定義の追加
- [x] Google Calendar APIから全カレンダー取得機能
- [x] `GET /api/calendars` API実装
- [x] `PATCH /api/calendars/:id` 表示切り替えAPI実装
- [x] `useCalendars` Hook実装
- [x] `CalendarSelector` コンポーネント拡張（コンパクトモード追加）
- [x] `src/lib/google-calendar.ts` にカレンダーリスト取得・複数カレンダーイベント取得機能を追加

---

## 📊 実装済みファイル一覧

### Phase 1.2: マルチカレンダー対応（統合完了）

#### Components (Updated for CalendarView Integration)
- `src/components/calendar/calendar-view.tsx` - useCalendars統合、selectedCalendarIdsをイベント取得に使用
- `src/components/calendar/calendar-header.tsx` - カレンダーセレクター（コンパクトモード）をヘッダーに追加

#### データベース
- `supabase/migrations/20260128_create_user_calendars.sql` - マイグレーション
- `src/types/database.ts` - user_calendars テーブル型定義を追加

#### API Routes
- `src/app/api/calendars/route.ts` - カレンダーリスト取得 API (GET)
- `src/app/api/calendars/[id]/route.ts` - 表示切り替え API (PATCH)

#### Hooks
- `src/hooks/useCalendars.ts` - カレンダー管理 Hook

#### Lib
- `src/lib/google-calendar.ts` - fetchUserCalendars, fetchMultipleCalendarEvents 追加

#### Components
- `src/components/calendar/calendar-selector.tsx` - マルチカレンダー対応版に書き換え

### Phase 1.4: タスク所要時間管理（基本機能完了）

#### データベース
- `supabase/migrations/20260128_add_calendar_event_id_to_tasks.sql`

#### API Routes
- `src/app/api/tasks/[id]/schedule/route.ts`
- `src/app/api/tasks/[id]/time/route.ts`
- `src/app/api/calendar/find-free-time/route.ts`

#### Hooks
- `src/hooks/useTaskScheduling.ts`
- `src/hooks/useFreeTimeSlots.ts`
- `src/hooks/useTimeConflictDetection.ts`

#### Components
- `src/components/tasks/task-time-input.tsx`
- `src/components/calendar/calendar-task-block.tsx`

#### Utils
- `src/lib/time-utils.ts`

---

## 🗄️ マイグレーション実行待ち

以下のマイグレーションを Supabase Dashboard で実行してください:

1. **Phase 1.4**:
   ```sql
   supabase/migrations/20260128_add_calendar_event_id_to_tasks.sql
   ```

2. **Phase 1.2**:
   ```sql
   supabase/migrations/20260128_create_user_calendars.sql
   ```

---

## 🔄 カレンダー表示の改善（完了）

- [x] イベントカードのコントラスト修正（白背景→ダークテキスト）
- [x] 文字サイズ縮小（10px → 9px）
- [x] パディング縮小（p-1.5 → p-1）
- [x] シンプルな表示（時間・タスクID削除）

---

## 📚 仕様書

- [docs/specs/phase1-calendar-implementation-plan.md](./docs/specs/phase1-calendar-implementation-plan.md) - **統合実装計画書（最新）**
- [docs/specs/phase1-2-multi-calendar-support.md](./docs/specs/phase1-2-multi-calendar-support.md)
- [docs/specs/phase1-1-calendar-event-sync.md](./docs/specs/phase1-1-calendar-event-sync.md)
- [docs/specs/phase1-2-calendar-selector.md](./docs/specs/phase1-2-calendar-selector.md)
- [docs/specs/phase1-3-notification-system.md](./docs/specs/phase1-3-notification-system.md)
- [docs/specs/phase1-4-task-time-management.md](./docs/specs/phase1-4-task-time-management.md)

---

## 📋 次のステップ

### Phase 1.2: マルチカレンダー対応（完了✅）
- [x] CalendarView との統合 - 選択カレンダーのイベントのみ表示
- [ ] テストと検証 - 共有カレンダーが正しく取得できるか確認

### Phase 1.4: タスク時間管理（統合）
1. **CalendarWeekView への統合** - タスクブロック表示
2. **CalendarMonthView への統合** - タスクバッジ表示
3. **タスク編集UI への統合** - TaskTimeInput 統合
4. **重複警告の実装**

---

## 🔧 技術的なメモ

### 既存の calendar-list API について
古い `/api/calendar/list` エンドポイントは新しい `/api/calendars` に置き換わりました。既存の `CalendarSelector` は新しいAPIとHookを使用するように更新済みです。

### カレンダーの取得範囲
- `minAccessRole: 'freeBusyReader'` - 最小限の権限でも取得
- 共有カレンダー、購読カレンダーも含む
- 非表示カレンダーは除外

### APIレート制限への対応
- 複数カレンダーのイベント取得は並列処理
- キャッシュを活用してGoogle API呼び出しを削減
- 最大2500件までのカレンダー/イベントに対応

---

**最終更新:** 2026-01-28
**現在のフェーズ:** Phase 1.2 実装完了（CalendarView統合済み）
**次のステップ:** テストと検証（マイグレーション実行後）
