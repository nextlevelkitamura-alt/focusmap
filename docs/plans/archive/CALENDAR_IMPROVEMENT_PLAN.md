# Calendar Improvement Plan（カレンダー改善計画）

## 📋 改善項目

### 改善1: 日付即時確定（設定ボタンを省略）
**現状**: 日付を選択 → 時間を選択 → 「設定」ボタンをクリック → 確定  
**改善後**: 日付を選択 → **即座に確定** → ポップオーバーを閉じる

### 改善2: Supabase スキーマ整備
**現状**: `tasks` テーブルに `scheduled_at` カラムがあるか不明  
**改善後**: `tasks` テーブルに `scheduled_at` カラムを追加（存在しない場合）

---

## 🎯 改善1: 日付即時確定

### 現在の問題
- UXフローが長い（3ステップ必要）
- 「設定」ボタンを押し忘れると変更が反映されない
- モバイルでは特にタップ回数が多くて面倒

### 目標UX
1. カレンダーアイコンをクリック → ポップオーバーが開く
2. 日付をクリック → **即座に確定してポップオーバーが閉じる**
3. 完了（1ステップ削減）

### 実装方針

#### パターンA: 日付のみのシンプルピッカー（推奨）
- **時間ホイールを削除**
- 日付選択のみに特化
- クリックした瞬間に確定
- デフォルト時間: 09:00（固定）

**メリット**:
- 最もシンプル
- UXが直感的
- 実装が簡単

**デメリット**:
- 時間を細かく指定できない

#### パターンB: 2段階ピッカー（日付 → 時間）
- 日付をクリック → 時間選択画面に遷移
- 時間をクリック → 確定
- 全体で2クリック

**メリット**:
- 時間も指定できる
- 比較的シンプル

**デメリット**:
- 実装が複雑

#### パターンC: 日付選択 + 時間プリセット
- 日付をクリック → 即座に確定（デフォルト時間: 09:00）
- 時間を変更したい場合は、タスクをもう一度クリック → 時間のみ編集

**メリット**:
- 日付の即時確定と時間指定の両立
- 柔軟性が高い

**デメリット**:
- 実装がやや複雑

### 推奨: パターンA（日付のみのシンプルピッカー）

**理由**:
- タスク管理では「いつやるか」が最重要
- 時間は後から調整できれば十分
- ユーザーの80%は時間を細かく指定しない

### 実装手順

#### Step 1-1: TimeWheel を非表示にする
```tsx
// date-time-picker.tsx
// TimeWheel コンポーネントをコメントアウトまたは条件付きレンダリング
```

#### Step 1-2: 日付選択時に即座に確定
```tsx
const handleDateSelect = (newDate: Date | undefined) => {
    if (!newDate) return
    
    // デフォルト時間を設定（09:00）
    newDate.setHours(9)
    newDate.setMinutes(0)
    
    // 即座に確定
    setDate(newDate)
    setIsOpen(false) // ポップオーバーを閉じる
}
```

#### Step 1-3: フッターボタンを削除
```tsx
// 「キャンセル」「設定」ボタンを削除
```

#### Step 1-4: 動作確認
- カレンダーアイコンをクリック
- 日付をクリック
- 即座にポップオーバーが閉じて、日付が設定されることを確認

---

## 🗄️ 改善2: Supabase スキーマ整備

### 現状確認が必要な項目
1. `tasks` テーブルに `scheduled_at` カラムが存在するか？
2. カラムの型は何か？（`timestamp with time zone` が理想）
3. デフォルト値は設定されているか？
4. NULL を許可しているか？

### 実装手順

#### Step 2-1: 現在のスキーマを確認
```bash
# supabase/schema.sql を確認
```

#### Step 2-2: マイグレーションファイルを作成
```sql
-- supabase/add_scheduled_at_column.sql

-- scheduled_at カラムが存在しない場合は追加
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE;

-- インデックスを追加（パフォーマンス向上）
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_at
ON tasks(scheduled_at)
WHERE scheduled_at IS NOT NULL;

-- コメントを追加
COMMENT ON COLUMN tasks.scheduled_at IS 'タスクの予定日時（ユーザーが設定）';
```

#### Step 2-3: RLS ポリシーの確認
```sql
-- tasks テーブルの RLS ポリシーが scheduled_at を正しく扱えるか確認
-- 必要に応じてポリシーを更新
```

#### Step 2-4: マイグレーションを適用
```bash
# Supabase Studio で実行
# または、supabase CLI を使用
```

#### Step 2-5: TypeScript 型定義を更新
```typescript
// src/types/database.ts
export interface Task {
    id: string
    // ... 他のフィールド
    scheduled_at: string | null  // ISO 8601 形式
}
```

#### Step 2-6: 動作確認
- カレンダーで日付を設定
- Supabase Studio でデータを確認
- `scheduled_at` カラムに正しい値が保存されていることを確認

---

## ⚠️ 注意事項

### 改善1の注意点
- 時間ホイールを削除すると、既存の時間指定ユーザーが困る可能性
  → 解決策: タスククリック → 日付表示 → 再クリックで時間編集（将来実装）
- デフォルト時間（09:00）が適切か確認

### 改善2の注意点
- `scheduled_at` カラムが既に存在する場合、マイグレーションがエラーになる
  → 解決策: `ADD COLUMN IF NOT EXISTS` を使用
- RLS ポリシーが `scheduled_at` を正しく扱えるか確認が必要

---

## 📅 実行順序

### Phase 1: Supabase スキーマ確認・整備（先行）
**理由**: UI を変更する前に、データ保存先を確保する

1. Step 2-1: 現在のスキーマを確認
2. Step 2-2: マイグレーションファイルを作成
3. Step 2-3: RLS ポリシーの確認
4. Step 2-4: マイグレーションを適用
5. Step 2-5: TypeScript 型定義を更新
6. Step 2-6: 動作確認

### Phase 2: 日付即時確定の実装
**理由**: スキーマが整った後に UI を変更

1. Step 1-1: TimeWheel を非表示にする
2. Step 1-2: 日付選択時に即座に確定
3. Step 1-3: フッターボタンを削除
4. Step 1-4: 動作確認

---

## ✅ 完了条件

### Phase 1 完了条件
- [ ] `tasks` テーブルに `scheduled_at` カラムが存在する
- [ ] カラムの型が `timestamp with time zone` である
- [ ] インデックスが作成されている
- [ ] RLS ポリシーが正しく動作する
- [ ] TypeScript 型定義が更新されている

### Phase 2 完了条件
- [ ] 日付をクリックすると即座にポップオーバーが閉じる
- [ ] 日付が正しく設定される（デフォルト時間: 09:00）
- [ ] Supabase に正しく保存される
- [ ] 既存の機能（マインドマップ、タスクリスト）が壊れていない

---

## 🎯 次のアクション

1. **Phase 1 を開始します**:
   - `supabase/schema.sql` を確認
   - `scheduled_at` カラムの存在を確認
   - 必要に応じてマイグレーションファイルを作成

2. **Phase 1 完了後、Phase 2 を開始します**

---

**作成日**: 2026-01-24
**最終更新**: 2026-01-24
