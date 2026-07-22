'use client';

import { useState } from 'react';
import { ChevronRight, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlanCardV2 } from './theme-card';
import type { ThemeGroup } from './types';

// 子07「テーマ上位・4段化」: 段階0＝テーマカード。themes(active) を最上位の器にし、planRefs で解決した計画カード群
// （PlanCardV2）を入れ子で束ねる。既存3段（計画→工程→AIレーン・子06）の上にテーマ層を1枚かぶせるだけで、
// PlanCardV2 の中身は変えない。
// - 通常＝ヘッダ1行サマリ（テーマ名・束ねる計画数・全体進捗％・稼働/待機の粒・済/総）。デフォルト折りたたみ。
// - 展開＝配下の計画カード群を縦に並べる（段階1）。各計画の展開で工程（段階2）→AIレーン（段階3）は子06のまま。
// - 配下計画0（planRefs が全部closed等）＝「今日は動きなし」の静かな1行（展開しない）。沈黙はさせずテーマ自体は残す。
// - 状態色・点滅方針（実装中ピルのみ点滅）は下位部品が保持。折りたたみ状態はカード単位の useState（永続化しない）。
export function ThemeGroupCard({
  group,
  selectedDate,
  aiTargets,
}: {
  group: ThemeGroup;
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const { theme, title, plans, planCount, stepDone, stepTotal, stepPct, liveCount, waitCount } = group;
  const isUnassigned = theme === null;
  const expandable = plans.length > 0;

  // 右肩サマリ（計画数・進捗％・稼働/待機の粒・済/総）。PlanCardV2 のヘッダ粒と同じ視覚語彙を使う。
  const summary = (
    <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
      <span className="text-[10.5px]">{planCount}計画</span>
      {stepPct !== null ? (
        <span
          className={cn(
            'text-xs font-extrabold',
            stepPct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-700 dark:text-blue-300',
          )}
          aria-label={`完了${stepPct}パーセント`}
        >
          {stepPct}%
        </span>
      ) : null}
      {/* 稼働の粒（aidot）: 緑=稼働中・琥珀=確認待ち。点滅させない（点滅は工程の「実装中」ピルのみ・子06）。 */}
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
      {stepTotal > 0 ? (
        <span>
          済 {stepDone}/{stepTotal}
        </span>
      ) : null}
    </span>
  );

  // 配下計画なし＝「今日は動きなし」の静かな1行（テーマは沈黙させず残す）。
  if (!expandable) {
    return (
      <article className="overflow-hidden rounded-2xl border border-border/70 bg-card/60">
        <div className="flex min-h-11 items-center gap-2 px-3 py-2.5">
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold leading-snug text-muted-foreground">
            {title}
          </h2>
          <span className="shrink-0 text-[10.5px] text-muted-foreground">今日は動きなし</span>
        </div>
      </article>
    );
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* テーマ帯（最上位・段階0のヘッダ。タップで展開/折りたたみ） */}
      <div className={cn(isUnassigned ? 'bg-muted/40' : 'bg-muted/60 dark:bg-muted/30')}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={`テーマ ${title} を${open ? '折りたたむ' : '展開する'}`}
          className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left"
        >
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
            aria-hidden
          />
          <Layers className={cn('h-4 w-4 shrink-0', isUnassigned ? 'text-muted-foreground' : 'text-primary')} aria-hidden />
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-extrabold leading-snug">{title}</h2>
          {summary}
        </button>
      </div>

      {/* 段階1: 配下の計画カード群（PlanCardV2 をそのまま入れ子。内側パディングは幅を削らないよう最小限） */}
      {open ? (
        <div className="space-y-2.5 border-t border-border bg-muted/[0.04] p-2">
          {plans.map((card) => (
            <PlanCardV2
              key={card.planSlug || `theme:${card.theme?.id ?? ''}`}
              data={card}
              selectedDate={selectedDate}
              aiTargets={aiTargets}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}
