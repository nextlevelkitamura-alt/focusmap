---
feature: calendar-event-edit-modal
type: feature
method: impl
created: 2026-02-12
updated: 2026-02-13
status: planning
---

# 設計プラン: カレンダーイベント編集UI（Googleカレンダー風）

## コンセプト

**2段構えUI**: タップ → ポップオーバー（概要＋クイック操作）→ 「編集」で フルモーダル

Googleカレンダーのような直感的な体験を目指す。

## UI構成

### Step 1: ポップオーバー（イベントタップ時）

イベントカードをクリックすると、イベントの近くにポップオーバーが表示される。

```
┌──────────────────────────────┐
│  ✕                           │
│                              │
│  📌 ミーティング              │  ← タイトル（太字）
│                              │
│  🕐 14:00 〜 15:00           │  ← 時間
│  📅 2026年2月13日（木）       │  ← 日付
│  📁 仕事カレンダー            │  ← カレンダー名（色付き●）
│  🔴 優先度: 高               │  ← 優先度バッジ
│  🔔 15分前に通知              │  ← 通知設定
│                              │
│  [✏️ 編集]  [🗑️ 削除]        │  ← アクションボタン
└──────────────────────────────┘
```

**表示項目**:
- タイトル（太字）
- 日時（開始〜終了）
- カレンダー名（色付きドット）
- 優先度バッジ（高=赤、中=黄、低=緑）
- 通知設定（あれば）
- 編集ボタン → フルモーダルへ
- 削除ボタン → 確認ダイアログ → 削除

### Step 2: フル編集モーダル（「編集」ボタン押下時）

画面中央にオーバーレイ付きモーダル。

```
┌────────────────────────────────────┐
│  イベントを編集              ✕     │
│────────────────────────────────────│
│                                    │
│  タイトル                          │
│  ┌────────────────────────────┐   │
│  │ ミーティング                │   │
│  └────────────────────────────┘   │
│                                    │
│  開始        終了                  │
│  ┌──────┐   ┌──────┐             │
│  │ 14:00│   │ 15:00│             │
│  └──────┘   └──────┘             │
│  ┌──────────────────┐            │
│  │ 2026-02-13       │            │
│  └──────────────────┘            │
│                                    │
│  優先度                            │
│  ┌──────────────────┐            │
│  │ 高 ▼             │            │
│  └──────────────────┘            │
│                                    │
│  カレンダー                        │
│  ┌──────────────────┐            │
│  │ 🔴 仕事 ▼       │            │
│  └──────────────────┘            │
│                                    │
│        [キャンセル]  [保存]        │
└────────────────────────────────────┘
```

**編集可能項目**:
1. **タイトル**（テキスト入力、必須）
2. **開始時刻・終了時刻**（時間セレクター、15分刻み）
3. **日付**（date input）
4. **優先度**（高・中・低 セレクト）
5. **カレンダー種別**（連携中カレンダーから選択）

**対象外（v1）**: 通知設定の編集、繰り返し設定、カレンダー間移動、メモ

## 技術仕様

### コンポーネント構成

```
calendar-event-popover.tsx   ← 新規: ポップオーバー
calendar-event-edit-modal.tsx ← 既存を更新: フル編集モーダル
```

### ポップオーバー Props

```typescript
interface CalendarEventPopoverProps {
  event: CalendarEvent
  anchorEl: HTMLElement | null  // ポップオーバーの位置基準
  isOpen: boolean
  onClose: () => void
  onEdit: () => void           // フルモーダルを開く
  onDelete: (eventId: string) => Promise<void>
}
```

### フルモーダル Props

```typescript
interface CalendarEventEditModalProps {
  event: CalendarEvent | null
  isOpen: boolean
  onClose: () => void
  onSave: (eventId: string, updates: EventUpdatePayload) => Promise<void>
  availableCalendars: Array<{ id: string; name: string; color: string }>
}

interface EventUpdatePayload {
  title: string
  start_time: string  // ISO format
  end_time: string    // ISO format
  priority?: 'high' | 'medium' | 'low'
  calendar_id?: string
}
```

### 使用ライブラリ

- **Radix UI Popover** — ポップオーバー
- **Radix UI Dialog** — フルモーダル
- **Radix UI Select** — 優先度・カレンダー選択
- **date-fns** — 日時フォーマット

## 実装フェーズ

### Phase 1〜4: 編集UI（完了）
- [x] イベントクリック → 直接編集モーダル方式に決定（2段構えポップオーバーは不採用）
- [x] `calendar-event-edit-modal.tsx` — タイトル、時刻、所要時間、優先度、カレンダー、通知、削除
- [x] `calendar-event-card.tsx` — クリックハンドラ変更
- [x] `sidebar-calendar.tsx` — prompt() 削除、モーダル統合
- [x] UIポリッシュ（ローディング、バリデーション、Esc、アニメーション）

### Phase 5: タスク⇄カレンダーリンク改善（進行中）
- [ ] ID管理の統一（google_event_id を single source of truth に）
- [ ] useCalendarEvents の task_id 照合ロジック改善
- [ ] スケジュール解除/削除時の google_event_id クリア漏れ修正
- [ ] estimated_time 変更時のカレンダー同期追加
- [ ] 編集モーダル保存時の双方向更新確認・修正

## 実装対象ファイル

### 新規作成
- `src/components/calendar/calendar-event-popover.tsx`

### 変更
- `src/components/calendar/calendar-event-edit-modal.tsx`
- `src/components/calendar/calendar-event-card.tsx` — クリックハンドラ変更
- `src/components/dashboard/sidebar-calendar.tsx` — prompt() 削除、状態管理

## 推奨実装方式

→ **/impl**（UIコンポーネント作成、既存APIを利用）
