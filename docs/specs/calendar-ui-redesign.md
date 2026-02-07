**技術スタック:** Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix UI
**テーマ:** ダークモード（CSS変数ベース: `bg-background`, `text-foreground` 等）

### アプリのレイアウト

```
┌──────────┬─────────────────────┬──────────────────┐
│ Left     │  Center Pane        │  Right Sidebar   │
│ Sidebar  │  (MindMap + Tasks)  │  (Calendar)      │
│ (Tree)   │                     │                  │
│ ~280px   │  flex-1             │  ~300px          │
│          │                     │  (resizable)     │
└──────────┴─────────────────────┴──────────────────┘
```

カレンダーは **右サイドバー（300px〜500px幅）** に表示されます。
狭い幅でも美しく表示できるデザインが必須です。

---

## 2. 対象ファイル一覧

### 触ってよいファイル（UIのみ変更）

| ファイル | 役割 | 行数 |
|---------|------|------|
| `src/components/calendar/calendar-view.tsx` | メインコンテナ | ~128行 |
| `src/components/calendar/calendar-header.tsx` | ヘッダー（ナビ、ビュー切替） | ~165行 |
| `src/components/calendar/calendar-week-view.tsx` | 週ビュー | ~243行 |
| `src/components/calendar/calendar-day-view.tsx` | 日ビュー | ~150行 |
| `src/components/calendar/calendar-month-view.tsx` | 月ビュー | ~127行 |
| `src/components/calendar/calendar-event-card.tsx` | イベントカード | ~100行 |
| `src/components/calendar/mini-calendar.tsx` | ミニカレンダー | ~71行 |

### 触ってはいけないファイル（ロジック層）

| ファイル | 理由 |
|---------|------|
| `src/hooks/useCalendarDragDrop.ts` | ドラッグ＆ドロップロジック |
| `src/hooks/useScrollSync.ts` | スクロール同期ロジック |
| `src/hooks/useCalendarEvents.ts` | データ取得フック |
| `src/hooks/useCalendars.ts` | カレンダー選択管理 |
| `src/lib/calendar-layout.ts` | イベント重複レイアウトアルゴリズム |
| `src/lib/calendar-constants.ts` | 共通定数 |
| `src/components/dashboard/right-sidebar.tsx` | サイドバーコンテナ |

---

## 3. デザイン要件

### 3.1 全体の方針

- **Google Calendar のダークモード** を参考にした、モダンで洗練されたデザイン
- 狭いサイドバー幅（300〜500px）でも見やすいコンパクトなレイアウト
- CSS変数（`bg-background`, `text-foreground`, `bg-muted`, `text-muted-foreground`, `bg-primary`, `text-primary-foreground` 等）を使用すること
- ハードコードされたカラー（`bg-[#121212]` 等）は使わない
- ただしGoogle Calendarのブランドカラー（`#4285F4`）はミニカレンダーのアクセントに使用OK

### 3.2 カレンダーヘッダー (`calendar-header.tsx`)

**現状の問題:**
- Google Calendar の favicon を外部URL（gstatic.com）から読み込んでいる → 削除する
- ビュー切替ボタンがやや大きい

**要件:**
- 「カレンダー」のタイトルとアイコンを適切に
- ビュー切替（日/週/月）はコンパクトに
- 日付ナビゲーション（前/次/今日）は直感的に
- 全体で高さ60px以内に収める

### 3.3 週ビュー (`calendar-week-view.tsx`)

**現状の問題:**
- グリッド線が `border-white/[0.03]` で薄すぎて見えにくい
- 時間ラベルが小さい

**要件:**
- グリッド線は `border-border/10` を推奨（ダークモードで適度に見える）
- 現在時刻インジケーター（赤い線）は維持
- 曜日ヘッダーの「今日」ハイライトは維持
- イベントカードの表示は後述

### 3.4 日ビュー (`calendar-day-view.tsx`)

**要件:**
- 週ビューと統一感のあるデザイン
- 時間ラベルの幅は `w-12`（48px）で統一

### 3.5 月ビュー (`calendar-month-view.tsx`)

**要件:**
- 日付セルは等高で整列
- 「今日」の日付は丸いハイライト（`bg-primary`）
- 月初は「M月d日」形式、それ以外は日付のみ（現在の仕様を維持）
- イベントチップは背景色付きで truncate

### 3.6 イベントカード (`calendar-event-card.tsx`)

**現状の問題:**
- コントラスト計算がハードコードのリスト比較で不正確
- ホバー時の編集/削除ボタンの `bg-inherit/10` が効かない

**要件:**
- Google Calendar 準拠の色使い: イベントの `background_color` をそのまま使用
- テキストは白を基本とし、背景が明るい場合のみ暗い文字に
- コントラスト計算は輝度ベース（RGB → 相対輝度 → 閾値判定）に改善
- フォントサイズ: 時刻 10px, タイトル 11px
- ホバー時: 軽い brightness 変化 + 編集/削除アイコン表示

### 3.7 ミニカレンダー (`mini-calendar.tsx`)

**現状の状態:**
- react-day-picker を使用
- Tailwind クラスでスタイリング済み（リファクタ完了）
- グローバルCSS問題は修正済み

**要件:**
- 現在のデザインを維持（Google Calendar 風）
- `#4285F4` のアクセントカラーを維持

---

## 4. 共通定数（参照用）

`src/lib/calendar-constants.ts`:

```typescript
export const HOUR_HEIGHT = 64        // 1時間の高さ（px）
export const DAY_TOTAL_HEIGHT = 1536 // 24時間の高さ（px）
export const DEFAULT_SCROLL_HOUR = 9 // 初期スクロール位置
export const HOURS = [0..23]         // 時間配列
export const MIN_GRID_WIDTH_WEEK = 600
export const MIN_GRID_WIDTH_DAY = 300
```

これらの値は**変更しないでください**。レイアウト計算はこれらに依存しています。

---

## 5. 注意事項

1. **Tailwind CSS 4** を使用 — `@apply` は使わず、ユーティリティクラスを直接使用
2. **`cn()` ユーティリティ** — 条件付きクラスの結合に使用（`@/lib/utils` からインポート）
3. **Radix UI コンポーネント** — `Button`, `ScrollArea` 等は `@/components/ui/` からインポート
4. **date-fns** — 日付操作に使用。ロケールは `ja`（日本語）
5. **アニメーション** — `transition-all duration-300` 等の Tailwind アニメーションを活用
6. **レスポンシブ** — 右サイドバーは `lg:` 以上で表示（`hidden lg:block`）

---

## 6. 実装手順の推奨

1. `calendar-event-card.tsx` — コントラスト計算の改善から始める（他全てに影響）
2. `calendar-header.tsx` — ヘッダーのデザイン刷新
3. `calendar-week-view.tsx` — グリッド線・全体の見た目改善
4. `calendar-day-view.tsx` — 週ビューと統一
5. `calendar-month-view.tsx` — 月ビューの改善
6. `mini-calendar.tsx` — 微調整（必要に応じて）
7. 全体の統一感チェック

---

## 7. ビルド・確認方法

```bash
npm run dev     # 開発サーバー起動
npm run build   # ビルド確認（型エラーチェック）
```

ダッシュボード画面（`/dashboard`）でカレンダーが表示されます。
Google アカウントでログイン後、右サイドバーにカレンダーが表示されます。

---

**作成日:** 2026-02-07
**作成者:** Claude (リファクタリング + 仕様書作成)
**対象:** Gemini 3.0 Pro (UI刷新担当)
