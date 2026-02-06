# Calendar UI Fix Plan V2 (Hydration Error 対策版)

## 🚨 判明した根本原因

### エラー内容
```
Uncaught Error: Minified React error #418
```

### React Error #418 とは？
**"Hydration failed because the server rendered HTML didn't match the client"**

これは Next.js の SSR (Server-Side Rendering) 時に発生する問題で：
- サーバー側でレンダリングされた HTML
- クライアント側でレンダリングされた HTML
- **この2つが一致しない**ときに発生

### なぜカレンダーが表示されないのか？
Hydration エラーが発生すると、React は：
1. レンダリングを中断
2. コンポーネントを破棄
3. 結果として**何も表示されない（または壊れた状態）**

---

## 🔍 Calendar コンポーネントで Hydration Error が起きる理由

### 原因1: `formatCaption` での日付フォーマット
```tsx
formatters={{
    formatCaption: (m) => format(m, "yyyy年M月", { locale: ja }),
}}
```
- `date-fns` の `format` 関数が SSR 時とクライアント時で**異なる文字列**を返している可能性
- タイムゾーンや locale の初期化タイミングの違い

### 原因2: `DayPicker` コンポーネント自体の SSR 非対応
- `react-day-picker` が内部で `document` や `window` を参照している
- SSR 時は `window` が存在しないため、レンダリング結果が異なる

### 原因3: 日付の初期値
```tsx
const [tempDate, setTempDate] = React.useState<Date | undefined>(date)
```
- `new Date()` が SSR 時とクライアント時で異なる値を返す

---

## 🛠️ 修正計画（Phase 1-3）

### Phase 1: Hydration Error の回避（最優先）
**目的**: カレンダーを**クライアントサイドのみ**でレンダリングして表示させる

#### Step 1-1: Calendar を dynamic import で読み込む
```tsx
// date-time-picker.tsx
import dynamic from 'next/dynamic'

const Calendar = dynamic(() => import('@/components/ui/calendar').then(mod => ({ default: mod.Calendar })), {
    ssr: false
})
```

**効果**: SSR を完全にスキップし、クライアントでのみレンダリング

#### Step 1-2: または、PopoverContent 全体を条件付きレンダリング
```tsx
const [isMounted, setIsMounted] = React.useState(false)

React.useEffect(() => {
    setIsMounted(true)
}, [])

return (
    <Popover>
        {/* ... */}
        {isMounted && (
            <PopoverContent>
                <Calendar ... />
            </PopoverContent>
        )}
    </Popover>
)
```

**効果**: クライアントでマウントされるまでカレンダーを表示しない

---

### Phase 2: formatCaption の問題を修正
**目的**: 日付フォーマットを SSR-safe にする

#### Step 2-1: formatCaption を削除してデフォルトに戻す
```tsx
// 一旦これを削除
formatters={{
    formatCaption: (m) => format(m, "yyyy年M月", { locale: ja }),
}}
```

#### Step 2-2: caption_label で静的にスタイルを当てる
```tsx
classNames={{
    caption_label: "text-xl font-bold text-zinc-100",
}}
```

---

### Phase 3: その他の SSR 問題を修正
**目的**: 残りの不一致を解消

#### Step 3-1: 初期値を undefined に統一
```tsx
// 変更前
const [tempDate, setTempDate] = React.useState<Date | undefined>(date)

// 変更後
const [tempDate, setTempDate] = React.useState<Date | undefined>(undefined)

React.useEffect(() => {
    if (isOpen) {
        setTempDate(date || new Date())
    }
}, [isOpen, date])
```

#### Step 3-2: showOutsideDays を false に（SSR 時の計算を減らす）
```tsx
<Calendar
    showOutsideDays={false}  // サーバー/クライアントの差異を減らす
    fixedWeeks
    ...
/>
```

---

## ✅ 実装の優先順位

### 🥇 最優先（Phase 1-1）: dynamic import
**これで90%の確率で表示される**

### 🥈 次点（Phase 2-1）: formatCaption 削除
**Hydration の原因を根本から除去**

### 🥉 保険（Phase 1-2）: 条件付きレンダリング
**dynamic import が効かない場合の代替案**

---

## 📝 修正コード（Phase 1-1 実装）

### ファイル1: `src/components/ui/date-time-picker.tsx`

```tsx
"use client"

import * as React from "react"
import dynamic from "next/dynamic"  // 追加
import { Calendar as CalendarIcon, ChevronDown, ChevronUp } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"

// Calendar を dynamic import（SSR を無効化）
const Calendar = dynamic(
    () => import("@/components/ui/calendar").then((mod) => ({ default: mod.Calendar })),
    {
        ssr: false,
        loading: () => (
            <div className="w-[280px] h-[280px] flex items-center justify-center text-zinc-500">
                読み込み中...
            </div>
        ),
    }
)

// 以下は既存のまま
```

**変更点**:
1. `import { Calendar } from "@/components/ui/calendar"` を削除
2. `dynamic` で Calendar を読み込み、`ssr: false` を指定
3. `loading` で読み込み中の表示を追加（オプション）

---

## 🎯 次のアクション

### 選択肢A: Phase 1-1 を実行（推奨）
**私が `date-time-picker.tsx` を修正**して、dynamic import を追加します。
→ 「Phase 1-1 を実行してください」と言ってください

### 選択肢B: Phase 1-1 + Phase 2-1 を同時実行
**dynamic import + formatCaption 削除**を一度に行います（より確実）。
→ 「Phase 1-1 と 2-1 を実行してください」と言ってください

---

## 📚 参考情報

- React Error #418: https://react.dev/errors/418
- Next.js Dynamic Import: https://nextjs.org/docs/app/building-your-application/optimizing/lazy-loading
- react-day-picker SSR issues: https://github.com/gpbl/react-day-picker/issues

---

**作成日**: 2026-01-24
**最終更新**: 2026-01-24 (V2: Hydration Error 対策版)
