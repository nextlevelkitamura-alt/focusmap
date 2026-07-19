'use client';

import { useState } from 'react';

// 子09: 起票フォームのテーマ選択。既存の active テーマから選ぶか「新しいテーマを作る」。
// 新規は名前だけで即席作成（目的・完了条件は空＝未記入バッジ・人間の空作成は可）。未選択は「未分類」。
// addTodo の themeId（"__new__" + newThemeName）を組み立てるだけの薄いクライアント。
export function ThemeSelect({ themes }: { themes: { id: string; name: string }[] }) {
  const [value, setValue] = useState('');

  return (
    <div className="space-y-2">
      <select
        name="themeId"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="大課題テーマ"
        className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
      >
        <option value="">未分類</option>
        {themes.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
        <option value="__new__">＋ 新しいテーマを作る</option>
      </select>

      {value === '__new__' ? (
        <input
          name="newThemeName"
          required
          placeholder="新しいテーマ名（目的・完了条件は後でボードから）"
          autoComplete="off"
          className="h-11 w-full rounded-md border border-dashed border-input bg-transparent px-3 text-sm"
        />
      ) : null}
    </div>
  );
}
