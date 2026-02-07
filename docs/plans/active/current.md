---
feature: Phase 1.1.2 - イベント表示の強化（カレンダーUI修正）
method: impl
created: 2026-02-07
---

# 設計プラン: カレンダーUI リデザイン・バグ修正

## ROADMAP 上の位置づけ
**Phase 1: Googleカレンダー完全連携（MVP）** > **1.1.2 イベント表示の強化**

Gemini 3.0 Pro が実装したカレンダー UI にバグがあり、**使用不可な状態**。
スクラッチから修正・リデザインして、右サイドバー環境で正常に動作するようにする。

---

## 🎯 要件

### 主な問題点
1. **月ビューのレイアウト崩れ**
   - セルのサイズがおかしい（テキスト重複、数字の折返し）
   - 6行固定グリッドがコンテンツに対応していない

2. **右サイドバーの幅非対応**
   - 300-500px の制約に合わせたデザイン不足
   - テキストが縦に並ぶなど、おかしい表示

3. **イベントカード周り**
   - コントラスト計算がおかしい可能性
   - ホバー時の編集/削除ボタンが効かない

4. **グリッド線の見え方**
   - グリッド線が薄い or 見えないセル

---

## 📋 実装フェーズ

### Phase 1: 基盤修正（レイアウト計算）
**対象**: `calendar-month-view.tsx`, `calendar-week-view.tsx`, `calendar-day-view.tsx`

- [ ] **月ビュー**: セル高さを `h-full` で対応、`grid-rows-6` の動作確認
- [ ] **月ビュー**: 日付・イベント数の truncate 処理、 `overflow-hidden` の徹底
- [ ] **週ビュー**: グリッド線の `border-border/10` が見えるか確認
- [ ] **日ビュー**: 時間ラベルと本体のレイアウト同期確認

### Phase 2: コンポーネント個別修正
**対象**: `calendar-event-card.tsx`, `calendar-header.tsx`

- [ ] **イベントカード**: コントラスト計算の確認（相対輝度ベース）
- [ ] **イベントカード**: ホバー時のボタン表示（`from-black/20` の背景が効いているか）
- [ ] **ヘッダー**: Google favicon を削除（外部URL削除）
- [ ] **ヘッダー**: ビュー切替ボタンが60px以内に収まっているか

### Phase 3: 統合テスト・微調整
- [ ] ブラウザで各ビュー（日/週/月）を確認
- [ ] 右サイドバー環境（300-500px）での見た目を確認
- [ ] レスポンシブ対応（`hidden lg:block` など）

---

## 🛠️ 実装対象ファイル

### 修正対象
- `src/components/calendar/calendar-month-view.tsx` ~ 139行
- `src/components/calendar/calendar-week-view.tsx` ~ 245行
- `src/components/calendar/calendar-day-view.tsx` ~ 154行
- `src/components/calendar/calendar-event-card.tsx` ~ 112行
- `src/components/calendar/calendar-header.tsx` ~ 148行

### 参考ファイル（変更なし）
- `src/lib/calendar-constants.ts` ← 定数は触らない
- `src/hooks/useCalendarDragDrop.ts` ← ロジックは触らない
- `src/hooks/useScrollSync.ts` ← ロジックは触らない

---

## 📊 リスク評価

| レベル | リスク |
|--------|--------|
| **HIGH** | 既存レイアウト計算の完全な理解がないと悪化させる可能性 |
| **MEDIUM** | CSS変数（`bg-background`、`border-border/10` など）の値が環境で異なる可能性 |
| **MEDIUM** | グリッド線の見え方が環境で異なる（コントラスト） |
| **LOW** | Tailwind CSS 4 のユーティリティ名の変更 |

**対策**: 各修正後に `npm run dev` でブラウザ確認を繰り返す

---

## 🔗 依存関係

- **Tailwind CSS 4** — ユーティリティクラス直接使用
- **date-fns** — 日付フォーマット（既に導入）
- **Radix UI** — UI コンポーネント（既に導入）
- **CSS変数** — `bg-background`, `text-foreground`, `border-border` など

---

## 💡 推奨実装方式

### `/impl` 推奨理由
✅ UI・スタイル修正が中心（ロジック変更なし）
✅ 各ステップで見た目をブラウザで確認しながら進められる
✅ バグが顕在化しやすい（視覚的フィードバック）

### コマンド
```bash
npm run dev    # 開発サーバー起動
npm run build  # ビルド確認（型エラーチェック）
```

ダッシュボード（`/dashboard`）でカレンダーを確認。
Google OAuth ログイン後、右サイドバーにカレンダーが表示されます。

---

## 📝 補足

- Gemini の実装内容（仕様書ベース）は悪くなかったが、実装時に**右サイドバー環境での見た目を考慮しきれていない**
- 本来は QA 段階で気づくべきバグだが、ここで修正する
- Phase 1.1.1（イベント取得）と並行できるので、優先度は **MEDIUM-HIGH**

---

**Ready to implement?** → `/impl` で実装開始
