'use client';

import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { undoCompleteAction } from '../actions';

// 段階2: 完了確定の直後 5秒だけ「取り消し」を出す。取り消しはDBへの正式undo遷移（open へ戻す）。
export function UndoBar({ todoId, date }: { todoId: string; date: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 5_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-600/40 bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-500/10">
      <span className="text-emerald-800 dark:text-emerald-300">完了にしました</span>
      <form action={undoCompleteAction}>
        <input type="hidden" name="id" value={todoId} />
        <input type="hidden" name="date" value={date} />
        <button
          type="submit"
          className="flex min-h-9 items-center gap-1.5 rounded-md border border-emerald-600/60 bg-background px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
        >
          <Undo2 className="h-3.5 w-3.5" />
          取り消す
        </button>
      </form>
    </div>
  );
}
