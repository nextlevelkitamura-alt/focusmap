# Calendar Improvement Plan V2（カレンダー改善計画 改訂版）

## 📋 改善内容（確定版）

### Phase 1: Supabase スキーマ確認
✅ **完了済み**
- `tasks` テーブルに `scheduled_at` カラムが既に存在
- 型も正しい（`timestamp with time zone`）
- TypeScript 型定義も正しい

### Phase 2: 日付即時確定 + 時間ホイール併用

---

## 🎯 Phase 2 の仕様（確定版）

### UX フロー

#### パターン1: 日付のみ選択（デフォルト時間）
1. カレンダーアイコンをクリック → ポップオーバーが開く
2. **日付をクリック → デフォルト時間（09:00）で即座に確定 → ポップオーバーが閉じる**
3. 完了

#### パターン2: 日付 + 時間を指定
1. カレンダーアイコンをクリック → ポップオーバーが開く
2. 日付をクリック → デフォルト時間（09:00）で即座に確定
3. **ポップオーバーは閉じない**（時間変更のため）
4. 時間ホイールで時間を変更 → **リアルタイムで更新**
5. ポップオーバー外をクリック → ポップオーバーが閉じる

### 実装方針

#### 変更点1: フッターボタンを削除
- 「キャンセル」ボタン → 削除
- 「設定」ボタン → 削除
- **理由**: ポップオーバー外をクリックすると閉じる仕様があるため不要

#### 変更点2: 日付選択時の動作
```typescript
const handleDateSelect = (newDate: Date | undefined) => {
    if (!newDate) return
    
    // デフォルト時間を設定（09:00）
    newDate.setHours(9)
    newDate.setMinutes(0)
    
    // tempDate を更新（時間ホイールで変更可能にする）
    setTempDate(newDate)
    
    // 即座に親コンポーネントに通知（確定）
    setDate(newDate)
    
    // オプション: ポップオーバーを閉じる（ユーザーが時間を変更したい場合は残しておく）
    // → 時間変更の余地を残すため、ここでは閉じない
}
```

#### 変更点3: 時間ホイールの動作
```typescript
const handleTimeChange = (type: "hour" | "minute", value: number) => {
    const newDate = tempDate ? new Date(tempDate) : new Date()
    if (type === "hour") newDate.setHours(value)
    else newDate.setMinutes(value)
    
    setTempDate(newDate)
    
    // リアルタイムで親コンポーネントに通知（確定）
    setDate(newDate)
}
```

#### 変更点4: ポップオーバーを閉じるタイミング
- 日付選択後、ユーザーが何もしなければ**自動で閉じない**（時間変更の余地を残す）
- ポップオーバー外をクリック → 閉じる（既存の動作）
- ESC キーを押す → 閉じる（既存の動作）

**オプション**: 日付選択後、1秒後に自動で閉じる（時間変更したい場合はすぐに操作すれば間に合う）

---

## 🛠️ 実装手順

### Step 2-1: フッターボタンを削除
```tsx
// date-time-picker.tsx
// 「キャンセル」「設定」ボタンの部分を削除
```

### Step 2-2: 日付選択時の動作を変更
```tsx
const handleDateSelect = (newDate: Date | undefined) => {
    if (!newDate) return
    
    // 現在の時間を保持（もし既に設定されていれば）
    const current = tempDate || new Date()
    
    // 新しい日付にデフォルト時間（09:00）を設定
    newDate.setHours(tempDate ? current.getHours() : 9)
    newDate.setMinutes(tempDate ? current.getMinutes() : 0)
    
    setTempDate(newDate)
    setDate(newDate) // 即座に確定
}
```

**ポイント**:
- 既に時間が設定されている場合は、その時間を保持
- 初回選択時はデフォルト時間（09:00）を設定

### Step 2-3: 時間ホイールの動作を変更
```tsx
const handleTimeChange = (type: "hour" | "minute", value: number) => {
    const newDate = tempDate ? new Date(tempDate) : new Date()
    if (type === "hour") newDate.setHours(value)
    else newDate.setMinutes(value)
    
    setTempDate(newDate)
    setDate(newDate) // リアルタイムで更新
}
```

### Step 2-4: onConfirm 関数を削除
```tsx
// もう不要なので削除
```

### Step 2-5: 動作確認
1. カレンダーアイコンをクリック
2. 日付をクリック → タスクに日付が設定される（09:00）
3. 時間ホイールで時間を変更 → リアルタイムで更新される
4. ポップオーバー外をクリック → 閉じる

---

## ⚙️ オプション機能（後で検討）

### オプション1: 日付選択後に自動でポップオーバーを閉じる
```tsx
const handleDateSelect = (newDate: Date | undefined) => {
    // ... 上記と同じ処理
    
    // 1秒後に自動で閉じる
    setTimeout(() => {
        setIsOpen(false)
    }, 1000)
}
```

**メリット**: UXがよりスムーズ  
**デメリット**: 時間を変更したいユーザーが焦る可能性

### オプション2: 時間変更後に自動でポップオーバーを閉じる
```tsx
const handleTimeChange = (type: "hour" | "minute", value: number) => {
    // ... 上記と同じ処理
    
    // 0.5秒後に自動で閉じる
    setTimeout(() => {
        setIsOpen(false)
    }, 500)
}
```

**メリット**: 時間変更後に自動で閉じるので便利  
**デメリット**: 分も変更したい場合に閉じてしまう

---

## ✅ 完了条件

- [ ] フッターボタン（キャンセル・設定）が削除されている
- [ ] 日付をクリックすると、デフォルト時間（09:00）で即座に確定される
- [ ] 時間ホイールで時間を変更すると、リアルタイムで更新される
- [ ] ポップオーバー外をクリックすると閉じる
- [ ] Supabase に正しく保存される
- [ ] 既存の機能（マインドマップ、タスクリスト）が壊れていない

---

## 🎯 次のアクション

Phase 2 を実行します：
1. Step 2-1: フッターボタンを削除
2. Step 2-2: 日付選択時の動作を変更
3. Step 2-3: 時間ホイールの動作を変更
4. Step 2-4: onConfirm 関数を削除
5. Step 2-5: 動作確認

---

**作成日**: 2026-01-24
**最終更新**: 2026-01-24 (V2: 時間ホイール併用版)
