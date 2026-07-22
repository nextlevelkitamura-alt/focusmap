'use client';

import { useState } from 'react';
import { ChevronRight, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SessionRow } from './session-row';
import type { SessionItem } from './types';

// 子05レーンB「計画外エージェント」ゾーン。
// テーマ→計画→工程→セッションの4段構造の外で動いている（plan/theme/todo をどれも宣言していない）稼働セッションの受け皿。
// 未分類(StrayBox)に他の無所属物と混ぜず、専用ゾーンで「今どのエージェントが計画外で動いているか」を見せる。
// セッションが board.py update --plan で計画を宣言すると build 側で計画カードへ振り分けられ、次ポーリングでこのゾーンから消える（自然に成立・特別なアニメ不要）。
// sessions が空なら非表示（null）。見た目は StrayBox / theme-group と同じ視覚語彙（折りたたみヘッダ＋件数バッジ＋稼働/待機の粒）。
export function UnplannedAgents({
  sessions,
  selectedDate,
}: {
  sessions: SessionItem[];
  selectedDate: string;
}) {
  // 計画外で動いているエージェントは見えることが目的なので既定は展開。折りたたみ状態は useState（永続化しない）。
  const [open, setOpen] = useState(true);
  if (sessions.length === 0) return null;

  const liveCount = sessions.filter(
    (s) => s.session.state === 'run' || s.session.state === 'sub',
  ).length;
  const waitCount = sessions.filter((s) => s.session.state === 'wait').length;

  return (
    <section
      aria-labelledby="unplanned-heading"
      className="rounded-xl border border-border/70 bg-card"
    >
      {/* ヘッダ1行（タップで展開/折りたたみ） */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={`計画外で動いているエージェントを${open ? '折りたたむ' : '展開する'}`}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronRight
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        <Activity className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2
          id="unplanned-heading"
          className="min-w-0 flex-1 truncate text-[13.5px] font-semibold leading-snug text-muted-foreground"
        >
          計画外で動いているエージェント
        </h2>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
          {liveCount > 0 ? (
            <span
              className="grid h-3.5 min-w-[14px] place-items-center rounded-full border border-emerald-500 bg-emerald-50 px-0.5 text-[8px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              title="稼働中"
            >
              {liveCount}
            </span>
          ) : null}
          {waitCount > 0 ? (
            <span
              className="grid h-3.5 min-w-[14px] place-items-center rounded-full border border-amber-500 bg-amber-100 px-0.5 text-[8px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
              title="確認待ち"
            >
              {waitCount}
            </span>
          ) : null}
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold">
            {sessions.length}件
          </span>
        </span>
      </button>

      {open ? (
        <div className="border-t border-border px-3 pb-2 pt-1">
          {sessions.map((item) => (
            <SessionRow key={item.session.sessionKey} item={item} selectedDate={selectedDate} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
