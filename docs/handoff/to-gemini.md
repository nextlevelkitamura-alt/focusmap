# Claude → Gemini 3.0 Pro 引き継ぎ

> このドキュメント全体を **Gemini 3.0 Pro にコピペスト** してください。

---

## 📋 引き継ぎ内容

**日時**: 2026-02-07
**プロジェクト**: Shikumika App — タスク管理とスケジュール管理を統合したプロダクティビティプラットフォーム

---

## 🎯 Gemini にやってもらいたいこと

### **カレンダー UI の複数ビュー対応 + デザイン強化**

現在のカレンダーは、Google Calendar との連携は実装されていますが、UI/UX がまだ基本的です。

以下の 2 つの機能を実装してください：

#### **1️⃣ 左側（タスク管理パネル）：カレンダー種別選択**
- 現在のタスク編集フォームに「カレンダー種別」ドロップダウンを追加
- Google Calendar から取得した情報を表示してカレンダーを選択可能にする
- オプション：「登録なし」「Personal」「Work」「その他」など
- アイコンクリック → カレンダー一覧を表示 → 種別を選択する流れ

#### **2️⃣ 右側（カレンダー UI）：複数ビュー対応 + Google Calendar 風デザイン**
- **複数ビューの実装**：
  - 📅 **月ビュー**（カレンダーグリッド型）
  - 📆 **週ビュー**（7日間の時間帯表示）
  - 📊 **3日ビュー**（3日間の詳細ビュー）
  - 📋 **日ビュー**（1日の詳細タイムライン）

- **UI 特性**：
  - Google Calendar のようなシンプルで洗練された見た目
  - 予定ごとに色分け（カレンダー種別の色を反映）
  - ビュー切替ボタンで簡単に切り替え可能
  - レスポンシブ対応（右サイドバー環境 300-500px に対応）

---

## 🎨 デザインイメージ

### **色分け・配色**
- **Google Calendar 風**：各カレンダー種別に異なる色を割り当て
- **背景**: ダークモード対応（既存の `bg-background`, `text-foreground` CSS変数を使用）
- **アクセント色**: 既存のカレンダーイベントカード色を踏襲

### **レイアウト**
- **ヘッダー**: ビュー切替ボタン（月/週/3日/日）を横に並べる
- **本体**: 選択されたビューに応じて、各ビューを表示
- **サイドバー対応**: 300-500px の幅で見やすく表示されること

### **雰囲気**
- シンプルで直感的
- Google Calendar のような定番の UI
- アニメーション：ビュー切替時にスムーズに遷移

---

## 🛠️ 技術情報

### **フレームワーク & ライブラリ**
- **フレームワーク**: Next.js 16 (App Router) + React 19
- **UI ライブラリ**: Radix UI + Tailwind CSS 4
- **State Management**: React Context + Custom Hooks
- **Date Handling**: date-fns
- **Google Calendar API**: googleapis (Node.js)

### **既存コンポーネント**
以下のコンポーネントは既に実装済みです。参考にしてください：

```
src/components/calendar/
├── calendar-month-view.tsx      ← 月ビュー（既存、改善可）
├── calendar-week-view.tsx       ← 週ビュー（既存、改善可）
├── calendar-day-view.tsx        ← 日ビュー（既存、改善可）
├── calendar-event-card.tsx      ← イベントカードコンポーネント
├── calendar-header.tsx          ← ヘッダー（既存、改善可）
└── index.ts
```

### **タスク管理パネル**
```
src/components/tasks/
├── task-panel.tsx               ← タスク管理パネル（左側）
├── task-form.tsx                ← タスク編集フォーム
└── index.ts
```

**`task-form.tsx` に「カレンダー種別」ドロップダウンを追加してください**

---

## 📁 作成・修正してほしいファイル

### **優先度 HIGH**

1. **`src/components/calendar/calendar-header.tsx`**
   - ビュー切替ボタンを追加（月/週/3日/日）
   - CSS または Tailwind で見た目を整える

2. **`src/components/calendar/calendar-month-view.tsx`**
   - Google Calendar 風のシンプルなグリッドレイアウト
   - 色分けされたイベントカード

3. **`src/components/calendar/calendar-week-view.tsx`**
   - 7日間の時間帯表示
   - 時間軸を左に、予定を右に配置

4. **`src/components/calendar/calendar-day-view.tsx`**
   - 1日のタイムライン表示
   - 時間軸と予定の詳細表示

5. **`src/components/tasks/task-form.tsx`（新規追加部分）**
   - 「カレンダー種別」ドロップダウンセクション
   - Google Calendar から取得した情報を表示

### **優先度 MEDIUM**

6. **新コンポーネント: `src/components/calendar/calendar-3day-view.tsx`**
   - 3日間のビュー（週ビューと日ビューの中間）

7. **`src/components/calendar/calendar-event-card.tsx`**
   - 色分けを正しく反映
   - ホバー時のインタラクション改善

---

## 📚 参考資料

以下のファイルをお読みください（Gemini に見てもらいたい資料）：

- **`docs/MAP.md`** ← プロジェクト全体像・Phase 説明
- **`src/types/database.ts`** ← database schema（tasks, calendar_events, user_calendars など）
- **`src/lib/calendar-constants.ts`** ← カレンダーの定数（曜日、時間帯など）
- **`src/hooks/useCalendarEvents.ts`** ← イベント取得ロジック（参考）

---

## 🔗 既存データ構造

### **tasks テーブル**
```typescript
{
  id: string
  user_id: string
  title: string
  scheduled_at: string | null        // 実行予定日時
  estimated_time: number              // 所要時間（分単位）
  parent_task_id: string | null       // 親タスク
  calendar_type: string | null        // カレンダー種別 ← 新規追加
  // ... その他カラム
}
```

### **calendar_events テーブル**
```typescript
{
  id: string
  google_event_id: string
  calendar_id: string
  title: string
  start_time: string                  // 開始日時
  end_time: string                    // 終了日時
  color: string | null                // イベント色
  // ... その他カラム
}
```

### **user_calendars テーブル**
```typescript
{
  id: string
  google_calendar_id: string
  name: string
  color: string | null                // カレンダー色
  background_color: string | null
  selected: boolean
  // ... その他カラム
}
```

---

## ✅ 実装時のチェックリスト

- [ ] 月/週/3日/日の 4 つのビューが実装されている
- [ ] ビュー切替ボタンが正常に動作している
- [ ] 予定が色分けされて表示されている
- [ ] Google Calendar 風のシンプルで洗練された UI
- [ ] 右サイドバー環境（300-500px）で見やすく表示される
- [ ] レスポンシブ対応（モバイルでも崩れない）
- [ ] タスク編集フォームに「カレンダー種別」ドロップダウンが追加されている
- [ ] TypeScript 型エラーが出ていない
- [ ] npm run build で正常にビルドできる

---

## 🎬 完了フロー

1. **実装完了後**：
   - コミットして、`docs/handoff/from-gemini.md` に実装内容を記入してください

2. **Claude に戻す**：
   - Claude 側で `/gemini-done` を実行して、実装内容を ROADMAP に反映します

3. **残りのロジック実装**：
   - Backend ロジック（DB スキーマ拡張、API 実装）は Claude が担当します

---

## 💡 重要：カレンダー反映ロジック

### **カレンダー種別が選ばれたタスク = 全部カレンダーに反映**

**ロジック**：
```
タスクがカレンダーに表示される条件:
1. ✅ カレンダー種別が「登録なし」以外で指定されている
2. ✅ 所要時間が 5 時間未満（300分未満）
3. ✅ 実行予定日が設定されている

親タスク・子タスク関係なく、上記 3 つを満たせば表示される
```

### **なぜこの仕様？**
- 完了したタスクが増えると、リーフタスク（最下層タスク）の位置がずれる
- その結果、カレンダー表示がおかしくなる（汚染される）
- **解決策**：「カレンダー種別を指定したタスク = カレンダーに表示」
- これにより、ユーザーが意図的に表示/非表示を制御できる

---

## 💡 補足

- **ドラッグ&ドロップ廃止**: 以前の仕様から変更され、タスク編集フォームでの設定のみになりました
- **「登録なし」オプション**: カレンダー種別を選ばないことで、カレンダーに表示させないことができる
- **5時間の上限**: 所要時間が 5 時間以上のタスクはカレンダーに表示されません

---

**質問・不明な点があれば、Gemini 内でお尋ねください。頑張ってください！** 🚀
