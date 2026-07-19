'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { runningCount, type SessionSubagent } from '@/lib/turso/session-subagents';

// 子08: エージェント行の下にサブエージェントの入れ子を出す（タップで展開）。
// 機械=hookが積んだ個体行を読み取り専用で表示する。ラベルは AI が sub-label で書いた値。
// ●稼働中(emerald) / ✔終了(muted) ＋ 所要/経過分（SQL導出）。終了サブも当日中は入れ子に残す。
// 「稼働中N体」は status='running' の集計（runningCount）でSQL由来を正として表示する。
export function SubagentNest({ subagents }: { subagents: SessionSubagent[] }) {
  const [open, setOpen] = useState(false);
  if (subagents.length === 0) return null;

  const running = runningCount(subagents);
  const done = subagents.length - running;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs text-muted-foreground hover:bg-muted/40"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="font-medium">サブ{subagents.length}体</span>
        <span className="text-muted-foreground/70">
          {running > 0 ? `稼働${running}` : '稼働0'}
          {done > 0 ? ` / 終了${done}` : ''}
        </span>
      </button>
      {open ? (
        <ul className="mt-0.5 space-y-1 pl-5">
          {subagents.map((sub) => (
            <li key={`${sub.sessionKey}-${sub.subSeq}`} className="flex items-baseline gap-1.5 text-xs">
              <span className="w-4 shrink-0 text-center" title={sub.status === 'running' ? '稼働中' : '終了'}>
                {sub.status === 'running' ? (
                  <span className="font-bold text-emerald-600">●</span>
                ) : (
                  <span className="font-bold text-muted-foreground">✔</span>
                )}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 break-words',
                  sub.status === 'running' ? 'text-foreground/80' : 'text-muted-foreground',
                  !sub.label && 'italic text-muted-foreground/60',
                )}
              >
                {sub.label || '(無題のサブ作業)'}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground/70">
                {sub.elapsedMin > 0 ? `${sub.elapsedMin}分` : sub.status === 'running' ? '開始' : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
