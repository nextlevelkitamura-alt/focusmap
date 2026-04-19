---
status: active
category: feature
priority: medium
created: 2026-04-19
updated: 2026-04-19
related: [calendar-event-edit-modal]
---

# 予定編集モーダルにメモ（description）ポップアップを追加

## 概要

予定編集モーダル（`CalendarEventEditModal`）の「所要時間」の下に、
メモを追加・表示できるポップアップを配置する。
長くなるのを避けるため、モーダル本体には「メモ」ボタンだけ置いて、
ボタン押下で別ポップアップが開いてそこでメモを編集する。

保存先は Google Calendar の `description` フィールド（= `calendar_events.description`）を使う。
これにより、**新規DBマイグレーション不要**で、かつ Google Calendar（PC/スマホ）と同期される。

## なぜやるか

- 予定にちょっとしたメモ（電話番号の補足、持ち物、リンク等）を残したい
- Google Calendar 側で同期されれば外出先でも確認できる
- モーダルが縦長にならないように、ポップアップ形式で UI を膨らませない

## 要件

- [ ] 予定編集モーダルの「所要時間」の下に「メモ」ラベル + ボタンを配置
- [ ] ボタンにはメモの有無が分かるプレビュー表示（例: 「メモ: なし」/「メモ: 最初の30文字…」）
- [ ] ボタン押下で中央ポップアップが開く（既存モーダルに重ねる）
- [ ] ポップアップは全画面ではなくモーダル中央のオーバーレイ（max-width 400px 程度）
- [ ] textarea で複数行入力可能（最大1000文字）
- [ ] 「保存」「キャンセル」ボタン
- [ ] 保存すると Google Calendar の `description` に書き込まれる（既存の PATCH 経由）
- [ ] 既存の予定を開いたとき、description があればそれを初期表示
- [ ] 新規作成時も同様に動作する

## 方式の選択

### 採用: 既存 `description` 列を使う（新規DB不要）

**メリット:**
- 新規マイグレーション不要
- Google Calendar と双方向同期（スマホ・PC・Google カレンダーアプリで見える）
- シンプル

**デメリット:**
- Google Calendar を使っていない/同期してないイベントでは保存できない
- Google Calendar 仕様上、description は 8KB 制限あり（1000文字なら余裕）

### 却下: 別テーブル `event_memos` を作る案

新規マイグレーション必要 + 同期考慮コスト大 + UX 上のメリットなし → 却下。

## 実装対象ファイル

### 作成するファイル
- `src/components/calendar/event-memo-popup.tsx`  ← 新規：メモ編集ポップアップ

### 変更するファイル
- `src/components/calendar/calendar-event-edit-modal.tsx`
  - 「所要時間」の下にメモボタンを配置
  - 内部 state に `memo` を追加
  - `EventUpdatePayload` に `description?: string` を追加
  - event.description を初期値にセット
- `src/types/calendar.ts` — `CalendarEvent` に `description?: string` が既にある場合は不要。なければ追加
- 予定の更新 API（`/api/calendar/events/[id]` 等）の PATCH で `description` を受け取って Google Calendar Events.patch に渡す
- `useCalendarSync` / 同期ロジック — description の read/write を通るか確認

### 削除するファイル
なし

## 実装フェーズ

### Phase 1: UI（ポップアップ + ボタン配置）
- [ ] `event-memo-popup.tsx` を作成（textarea + 保存/キャンセル）
- [ ] `CalendarEventEditModal` に memo state 追加
- [ ] 所要時間下にボタン配置（ラベル + プレビュー）
- [ ] ボタン押下でポップアップ表示（z-index モーダル上）
- [ ] 開閉アニメーション（既存パターンに合わせる）

### Phase 2: データ接続
- [ ] `EventUpdatePayload` に `description` を追加
- [ ] `calendar-event-edit-modal` の onSave に memo を含める
- [ ] API ルート（Google Calendar Events.patch）で description を反映
- [ ] 既存イベントを開いたときに description が初期表示される
- [ ] calendar_events キャッシュテーブルにも description が反映される（既存マイグレーションで対応済）

### Phase 3: QA & 仕上げ
- [ ] 1000 文字以上入力時のバリデーション + エラー表示
- [ ] 空メモの保存で description が空文字になるか null になるか確認・統一
- [ ] Google Calendar 側で description が更新されていることを確認（手動）
- [ ] スマホ UI（`mobile-event-edit-modal.tsx`）にも同様の機能を追加

## 完了条件

- [ ] 予定編集モーダルで「メモ」ボタンが所要時間の下に見える
- [ ] ボタンを押すとポップアップが出る
- [ ] メモを書いて保存すると Google Calendar の description に反映される
- [ ] 同じ予定を再度開くと、メモが初期表示される
- [ ] モーダル本体は縦に伸びない（ボタンだけで済む）
- [ ] スマホでも動く

## 非ゴール（今回やらない）

- メモのリッチテキスト編集（画像・リンクのビジュアル）
- メモの検索機能
- メモのバージョン履歴
- Google Calendar 以外の同期先

## メモ

- `description` は Google Calendar 公式フィールドで、PC 版 Google Calendar の「詳細」欄に表示される
- スマホの Google カレンダーでも「説明」として表示される
- HTML タグは使えるが、今回はプレーンテキストのみ
