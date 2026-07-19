'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { fileAgentAction } from '../actions';

// 子09 方針6: エージェント行の人間チェック。宣言済み todo_id を読むだけで
// 「終わったこと」へ格納（ありはタスク入れ子・なしは新見出し）。取り消し経路が無いため、
// 誤タップ防止に2アクション制（1タップで確認ポップ→格納 or やめる）にする。
export function FileAgentCheck({
  sessionKey,
  todoTitle,
  date,
  label,
}: {
  sessionKey: string;
  todoTitle: string;
  date: string;
  label: string;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setArmed((value) => !value)}
        aria-label={`${label}を完了として終わったことへ格納`}
        aria-expanded={armed}
        className="-ml-1.5 -mt-1.5 inline-grid h-10 w-10 place-items-center rounded-xl active:scale-95"
      >
        <span
          className={
            armed
              ? 'grid h-6 w-6 place-items-center rounded-lg bg-emerald-600 text-white'
              : 'h-6 w-6 rounded-lg border-2 border-slate-300 bg-white dark:border-slate-600 dark:bg-transparent'
          }
        >
          {armed ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      </button>

      {armed ? (
        <div className="absolute left-0 top-10 z-20 flex items-center gap-1.5 rounded-xl border border-border bg-background p-1.5 shadow-lg">
          <form action={fileAgentAction}>
            <input type="hidden" name="sessionKey" value={sessionKey} />
            <input type="hidden" name="todoTitle" value={todoTitle} />
            <input type="hidden" name="date" value={date} />
            <button
              type="submit"
              className="flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg bg-emerald-600 px-2.5 text-xs font-bold text-white active:scale-95"
            >
              <Check className="h-3.5 w-3.5" />
              終わったことへ格納
            </button>
          </form>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="min-h-9 shrink-0 rounded-lg border border-border px-2.5 text-xs text-muted-foreground"
          >
            やめる
          </button>
        </div>
      ) : null}
    </div>
  );
}
