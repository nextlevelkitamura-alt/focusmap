# Claude → Gemini 引き継ぎ

> この内容を Gemini 3.0 Pro にコピペストしてください

## 更新日時
2026-02-06

## プロジェクト
**しかみか (Shikumika)**: マインドマップとタスク管理を統合し、Google カレンダーと連携した統合的なプロダクティビティアプリ

## Gemini にやってもらいたいこと
**本格的カレンダーUI（Googleカレンダー風）** を実装してください

## 画面イメージ

### レイアウト
- **縦スクロールで時間が見えるタイムライン形式**（Googleカレンダー週ビューと同じ）
- 週ビュー: 7日間（または5営業日）の縦方向タイムライン
- 月ビュー: 既存の実装をベースにGoogleカレンダー風に
- 日ビュー: 新規追加（1日分の詳細タイムライン）

### 配色
- **Googleカレンダーとほぼ同じ**
- カレンダーごとの色分け（background_color, colorフィールドを活用）
- ライトモード・ダークモード両対応

### 雰囲気
- **Googleカレンダーそのまま**
- クリーンでミニマル
- ダークモード対応（theme/stateを確認して実装）

### 配置
- **ヘッダー固定**: カレンダーアイコン、タイトル、ビュー切り替え、ナビゲーション
- **ミニカレンダー**: 配置は検討（上部／右サイド／カラムで選択可能）
- **時間ラベル**: 左側固定
- **メインエリア**: スクロール可能なタイムライン

### その他
- **ドラッグ&ドロップ**: イベントの移動・時間変更
- **リアルタイム同期**: Googleアカウントと即時同期（既存のuseCalendarEvents, useCalendarsを活用）
- **複数カレンダー**: カレンダーの切り替え表示・色分け
- **現在時刻ライン**: 赤いラインで現在時刻を表示（既存実装あり）
- **イベントカード**: 重なり対応、色分け表示

## 技術情報

- **フレームワーク**: Next.js 16.1.3 (App Router), React 19
- **スタイリング**: Tailwind CSS 4
- **UIライブラリ**: Radix UI, Lucide Icons
- **カレンダーライブラリ**: react-day-picker, date-fns
- **バックエンド**: Supabase (PostgreSQL), Google Calendar API
- **状態管理**: React hooks（useCalendarEvents, useCalendars）
- **ダークモード**: next-themes（既存導入済み）

## 作成・修正してほしいファイル

### 新規作成
- `src/components/calendar/calendar-day-view.tsx` - 日ビューコンポーネント
- `src/components/calendar/mini-calendar.tsx` - ミニカレンダー（予定ある日を強調）

### 修正・改善
- `src/components/calendar/calendar-week-view.tsx` - Googleカレンダー風の週ビューに全面リデザイン
  - 現在は3日のみ → 7日（または5営業日）
  - イベントの重なり対応
  - ドラッグ&ドロップでイベント移動
- `src/components/calendar/calendar-month-view.tsx` - Googleカレンダー風の月ビューに改善
- `src/components/calendar/calendar-header.tsx` - ミニカレンダー追加、配置調整
- `src/components/calendar/calendar-view.tsx` - 日ビュー追加、ビュー切り替え改善
- `src/components/calendar/calendar-event-card.tsx` - 色分け、重なり対応改善

### 確認のみ（既存実装）
- `src/hooks/useCalendarEvents.ts` - イベント取得・同期
- `src/hooks/useCalendars.ts` - カレンダー管理
- `src/types/calendar.ts` - 型定義（color, background_colorフィールドあり）

## 既存コンポーネント

### 再用可能なもの
- `CalendarSelector` - カレンダー選択UI（複数カレンダー対応済み）
- `useCalendarEvents` - イベント取得フック（autoSync, syncInterval対応）
- `useCalendars` - カレンダー管理フック（selectedCalendarIds管理）
- 型定義: `CalendarEvent`, `UserCalendar`（色情報フィールドあり）

### 既存の実装詳細
- 週ビュー: 現在3日間のみ表示（`getWeekDates()`で昨日・今日・明日）
- 時間ラベル: 0-23時、64px/時間
- ドラッグ&ドロップ: タスクからのドロップには対応済み
- 現在時刻ライン: 赤いドット+ライン（既存実装あり）
- イベント位置計算: `getEventPosition()`（%ベース）

## 参考資料（Gemini にも見てほしい）

- **docs/ROADMAP.md** — 全体像
- **src/types/calendar.ts** — 型定義（色情報フィールドを確認）
- **src/hooks/useCalendarEvents.ts** — 同期処理の仕組み
- **src/hooks/useCalendars.ts** — カレンダー管理
- **src/components/calendar/calendar-selector.tsx** — カレンダー選択UI

## 実装のポイント

1. **7日間の週ビュー**: `getWeekDates()`を修正して月曜日〜日曜日（または設定で5営業日）
2. **イベントの重なり対応**: 同時間のイベントを横に並べる
3. **ドラッグ&ドロップ**: イベント自体をドラッグして移動・時間変更
4. **色分け**: `event.background_color`, `event.color` を活用
5. **ダークモード**: `next-themes` の `useTheme()` で判定
6. **リアルタイム同期**: 既存の `autoSync: true, syncInterval: 300000` を活用

## 完了したら
完了したら **`/gemini-done`** を実行してください。
**`docs/handoff/from-gemini.md`** に結果を記入してください。

---

## 補足: ユーザーの要望

> レイアウトは縦スクロールで時間を見ることができます。本当にGoogle CalendarみたいなUIです。ほぼGoogle Calendarと同じです。もちろんダークモードに対応しています。現在ダークモードで設定しているかどうか、ヘッダーなどを固定して、ミニカレンダーなどをどこに配置するのがいいんですかね。上でもいいし、右の方でもいいし、カラムで出したりでもいいと思います。あとは、正直カレンダーが分かれていると思うので、それに応じて色分けしてほしいです。そのあたりの情報も、正直同期しているかと思うので、そこのあたりもしっかり確認してもらいながら、同期の対応がしっかりできるように考えています。
