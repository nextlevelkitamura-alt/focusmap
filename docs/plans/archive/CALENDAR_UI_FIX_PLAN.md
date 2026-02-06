# Calendar UI Fix Plan (段階的改善計画)

## 📋 現状の問題

### 症状
- カレンダーグリッド（7列×6行）が表示されない
- 日付の数字だけが縦に1列で並んでいる
- 曜日ヘッダー（日月火水木金土）が見えない
- 時間ホイール、フッターボタンは正常に表示されている

### 試した対策と結果
1. ✅ `date-time-picker.tsx` に `table-fixed` を追加 → **効果なし**
2. ✅ `calendar.tsx` を `flex` → `table-fixed` に書き換え → **効果なし**

---

## 🔍 根本原因の仮説

### 仮説1: classNamesのマージ順序の問題
- `calendar.tsx` のデフォルト classNames
- `date-time-picker.tsx` から渡される classNames
- この2つが**マージされる際に、後者が前者を完全に上書き**している可能性

### 仮説2: react-day-picker のレンダリング構造の問題
- `DayPicker` コンポーネントが内部で `<table>` を生成しているが、
- 何らかのCSSまたはクラスが `display: block` や `display: flex` を強制している

### 仮説3: グローバルCSSの競合
- `globals.css` や Tailwind の base styles が `<table>` 要素に影響している

### 仮説4: date-time-picker.tsx の構造的問題
- カレンダーを囲む `<div>` の幅指定（`w-[280px]`）が効いていない
- または、内部の `Calendar` コンポーネントに渡すべき prop が不足している

---

## 🛠️ 段階的修正計画

### Phase 0: デバッグ情報の収集（コードは書かない）
**目的**: 何が起きているのか正確に把握する

#### Step 0-1: ブラウザ開発者ツールで DOM を確認
1. カレンダーを開く
2. 開発者ツール（F12）で Elements タブを開く
3. カレンダー部分の DOM 構造を確認：
   - `<table>` タグが存在するか？
   - `<thead>` / `<tbody>` / `<tr>` / `<td>` が正しくネストされているか？
   - どのような class が実際に適用されているか？

#### Step 0-2: Computed Styles を確認
1. `<table>` 要素を選択
2. "Computed" タブで `display` プロパティを確認
   - `table` になっているか？
   - `table-fixed` が効いているか？
3. `<tr>` 要素を選択
   - `display: table-row` になっているか？

#### Step 0-3: 幅の確認
1. `<table>` の `width` を確認
2. 親要素の `width` を確認

**期待される発見**:
- `display: flex` が残っている場合 → classNames のマージ問題
- `display: table` だが幅がおかしい場合 → 親要素の width 問題
- `<table>` が存在しない場合 → react-day-picker のバージョン問題

---

### Phase 1: 最小限の Calendar で動作確認
**目的**: `Calendar` コンポーネント単体が正常に動作するか確認

#### Step 1-1: calendar.tsx を最小構成に簡略化
- 一旦、すべての複雑な classNames を削除
- react-day-picker のデフォルトスタイルだけで表示してみる
- これで表示されれば、classNames の問題が確定

#### Step 1-2: 別の場所で Calendar を単体テスト
- `date-time-picker.tsx` を経由せず、
- dashboard などに直接 `<Calendar />` を置いて表示してみる
- これで表示されれば、`date-time-picker.tsx` の構造的問題が確定

---

### Phase 2: date-time-picker.tsx の構造を見直し
**目的**: Calendar を囲む親要素の問題を排除

#### Step 2-1: 親 div の幅指定を削除
```tsx
// 現状
<div className="flex flex-col w-[280px]">

// 試す
<div className="flex flex-col">
```

#### Step 2-2: classNames を Calendar に渡さない
```tsx
// 現状
<Calendar
    classNames={{...大量のカスタム classNames...}}
/>

// 試す（一旦すべて削除）
<Calendar
    mode="single"
    selected={tempDate}
    onSelect={handleDateSelect}
    locale={ja}
    weekStartsOn={0}
/>
```

---

### Phase 3: classNames を段階的に再適用
**目的**: どの classNames が問題を引き起こしているか特定

#### Step 3-1: table 系だけ追加
```tsx
classNames={{
    table: "w-full border-collapse table-fixed",
}}
```

#### Step 3-2: head_row / row を追加
```tsx
classNames={{
    table: "w-full border-collapse table-fixed",
    head_row: "table-row",
    row: "table-row",
}}
```

#### Step 3-3: 残りを順次追加
- `head_cell`
- `cell`
- `day`
- その他のスタイル

---

### Phase 4: 最終調整
**目的**: グリッドが表示されたら、見た目を V5 mockup に寄せる

#### Step 4-1: 曜日ヘッダーと日付の整列
- `table-layout: fixed` の確認
- セル幅の調整

#### Step 4-2: Today / Selected のスタイル適用

#### Step 4-3: outside days の薄色表示

#### Step 4-4: 時間ホイールとの間隔調整

---

## ✅ 検証チェックリスト

各 Phase 終了後、以下を確認：

- [ ] 7列のグリッド（日〜土）が表示される
- [ ] 曜日ヘッダーが表示される
- [ ] 日付が正しく配置される（6週間分）
- [ ] 各列の幅が均等である
- [ ] クリックで日付選択ができる

---

## 🎯 次のアクション

**まず Phase 0 を実行してください**:
1. ブラウザでカレンダーを開く
2. 開発者ツール（F12）で DOM 構造を確認
3. 以下の情報を報告：
   - `<table>` タグは存在するか？
   - `<table>` の `display` プロパティの値は？
   - `<tr>` の `display` プロパティの値は？
   - エラーメッセージがコンソールに出ていないか？

この情報をもとに、Phase 1 以降の具体的な修正コードを作成します。

---

## 📚 参考情報

- react-day-picker v9 公式ドキュメント: https://daypicker.dev/
- Tailwind CSS table utilities: https://tailwindcss.com/docs/table-layout

---

**作成日**: 2026-01-24
**最終更新**: 2026-01-24
