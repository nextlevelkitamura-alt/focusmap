'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { StrayData } from './types';

function agentDot(state: string) {
  if (state === 'run') return 'bg-emerald-500';
  if (state === 'sub') return 'bg-blue-500';
  if (state === 'wait') return 'bg-amber-500';
  return 'bg-muted-foreground';
}

function agentStateLabel(state: string) {
  if (state === 'run') return '稼働中';
  if (state === 'sub') return 'サブ稼働中';
  if (state === 'wait') return '待機中';
  return state || '状態不明';
}

// 未分類枠（モックv2 stray）。テーマに紐付かなかったものだけの例外枠。
// tasks/sessions/finishedLogs が全て空なら null。琥珀系の破線枠。
// 修正02: 通常状態はヘッダ1行（「未分類」＋件数バッジ）だけに畳み、タップで展開する（useState・永続化しない）。
// 吸収ボタン（テーマ割当）は流用できる server action が無いため付けない（新規 action は作らない・報告参照）。
export function StrayBox({
  stray,
}: {
  stray: StrayData;
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const finishedLogCount = stray.finishedLogs.reduce((sum, group) => sum + group.items.length, 0);
  const total = stray.tasks.length + stray.sessions.length + stray.finishedTodos.length + finishedLogCount;
  if (total === 0) return null;

  return (
    <section
      aria-labelledby="stray-heading"
      className="rounded-xl border border-dashed border-amber-400/70 bg-amber-50/70 dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      {/* ヘッダ1行（タップで展開/折りたたみ） */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={`未分類を${open ? '折りたたむ' : '展開する'}`}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronRight
          className={cn('h-4 w-4 shrink-0 text-amber-700 transition-transform dark:text-amber-400', open && 'rotate-90')}
          aria-hidden
        />
        <h2 id="stray-heading" className="min-w-0 flex-1 text-[11px] font-bold tracking-wider text-amber-700 dark:text-amber-400">
          未分類
        </h2>
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          {total}件
        </span>
      </button>

      {open ? (
        <div className="space-y-2 px-3 pb-3">
          {stray.tasks.length > 0 ? (
            <div className="space-y-1.5">
              {stray.tasks.map((item) => (
                <div key={item.todo.id} className="flex items-start gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 break-words">{item.todo.title}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="secondary" className="font-normal">
                      {item.repoName || 'repo未設定'}
                    </Badge>
                    {item.todo.carriedFrom ? (
                      <span className="text-[10.5px] text-muted-foreground">昨日から</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {stray.sessions.map((item) => (
            <div key={item.session.sessionKey} className="flex items-center gap-2 text-[12.5px]">
              <span className={`h-2 w-2 shrink-0 rounded-full ${agentDot(item.session.state)}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {item.session.now || item.session.goal || 'エージェント'}
              </span>
              <span className="shrink-0 text-[10.5px] text-muted-foreground">{agentStateLabel(item.session.state)}</span>
            </div>
          ))}

          {stray.finishedTodos.length > 0 ? (
            <details open className="border-t border-amber-400/30 pt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 text-[12px] text-muted-foreground [&::-webkit-details-marker]:hidden">
                <span className="text-[9px] transition-transform [details[open]_&]:rotate-90">▶</span>
                終わったこと（未分類）{stray.finishedTodos.length}件
              </summary>
              <div className="space-y-1.5 pl-4 pt-1">
                {stray.finishedTodos.map((f) => (
                  <div
                    key={f.todo.id}
                    className="flex items-baseline gap-2 text-[11.5px] text-slate-600 dark:text-slate-300"
                  >
                    <span className="shrink-0 font-bold text-emerald-600">✓</span>
                    <span className="min-w-0 flex-1 break-words">
                      {f.todo.title}
                      {f.doneSteps > 0 ? (
                        <span className="ml-1 text-muted-foreground">（✓ {f.doneSteps}ステップ完了）</span>
                      ) : null}
                    </span>
                    {f.runMin ? (
                      <span className="shrink-0 text-[10px] tabular-nums text-slate-400">実行{f.runMin}分</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {stray.finishedLogs.map((group) => (
            <div key={group.parent} className="space-y-1">
              <p className="text-[10.5px] font-semibold text-muted-foreground">{group.parent}</p>
              {group.items.map((entry, index) => (
                <div key={`${group.parent}-${index}`} className="flex items-baseline gap-2 text-[12px] text-slate-600 dark:text-slate-300">
                  <span className="shrink-0 font-bold text-emerald-600">✓</span>
                  <span className="min-w-0 flex-1 break-words">{entry.entry}</span>
                  {entry.count > 1 ? (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">×{entry.count}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
