'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { completeHeadingAction } from '../actions';

// 段階2: 見出しの「✓完了にする」は誤タップ防止の2アクション制。
// 1タップ目で幅広ボタンを開き、2タップ目（確定）でDBを done にして「終わったこと」へ移す。
export function CompleteControl({ todoId, date }: { todoId: string; date: string }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-600/60 bg-background px-3 py-2 text-sm font-semibold text-emerald-700 active:scale-[0.99] dark:text-emerald-400"
      >
        <Check className="h-4 w-4" />
        レビューして完了にする
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="min-h-11 shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
      >
        やめる
      </button>
      <form action={completeHeadingAction} className="flex-1">
        <input type="hidden" name="id" value={todoId} />
        <input type="hidden" name="date" value={date} />
        <button
          type="submit"
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white active:scale-[0.99]"
        >
          <Check className="h-4 w-4" />
          完了で確定
        </button>
      </form>
    </div>
  );
}
