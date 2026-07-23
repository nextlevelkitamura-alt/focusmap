'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronRight, Layers, Plus } from 'lucide-react';
import { ThemeEditor, type EditableTheme } from '@/app/dashboard/board/_components/theme-editor';
import type { Theme } from '@/lib/turso/themes';
import { cn } from '@/lib/utils';
import { PlanCardV2 } from './theme-card';
import type { ThemeGroup } from './types';

// Theme → Plan → 工程 → AI の入口。
// V5では「現在の動き」を別レーンにせず、各Planカードの中へライブAI行を統合する。
// Theme追加・Plan追加・翌日継続・D&D保存は次のDB接続段階。UI段階では押下時に境界を明示し、無反応にしない。
export function ThemeGroupCard({
  group,
  selectedDate,
  aiTargets,
  defaultOpen = false,
  compact = false,
  isPreview = false,
  onThemeChange,
}: {
  group: ThemeGroup;
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
  defaultOpen?: boolean;
  compact?: boolean;
  isPreview?: boolean;
  onThemeChange?: (theme: Theme) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [phaseNotice, setPhaseNotice] = useState('');
  const [themeOverride, setThemeOverride] = useState<Theme | null>(null);
  const theme = themeOverride ?? group.theme;
  const title = theme?.name ?? group.title;
  const plans = useMemo(
    () => themeOverride
      ? group.plans.map((plan) => plan.theme?.id === themeOverride.id ? { ...plan, theme: themeOverride } : plan)
      : group.plans,
    [group.plans, themeOverride],
  );
  const { planCount, stepDone, stepTotal, stepPct, liveCount, waitCount } = group;
  const isUnassigned = theme === null;
  const expandable = plans.length > 0;
  const activeCount = plans.filter((plan) => plan.bucket === 'active').length;
  const planningCount = plans.filter((plan) => plan.bucket === 'planning').length;

  const showNextPhaseNotice = (action: string) => {
    setPhaseNotice(`${action}の保存は、UI確認後のDB接続段階で実装します。`);
  };

  const handleThemeChange = (next: EditableTheme) => {
    if (!theme) return;
    const updated: Theme = { ...theme, ...next };
    setThemeOverride(updated);
    onThemeChange?.(updated);
  };

  if (!expandable) {
    return (
      <article className="overflow-hidden rounded-2xl border border-border/70 bg-card/60">
        <div className="flex min-h-14 flex-wrap items-center gap-2 px-3 py-2.5">
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[13.5px] font-semibold leading-snug text-muted-foreground">{title}</h2>
            {theme?.purpose ? <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground/80">{theme.purpose}</p> : null}
          </div>
          <span className="shrink-0 text-[10.5px] text-muted-foreground">今日は動きなし</span>
          {theme ? (
            <ThemeEditor
              theme={{
                id: theme.id,
                name: theme.name,
                purpose: theme.purpose,
                doneCriteria: theme.doneCriteria,
                goalRef: theme.goalRef,
              }}
              date={selectedDate}
              isPreview={isPreview}
              onThemeChange={handleThemeChange}
            />
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article className={cn('overflow-hidden rounded-2xl border bg-card', open ? 'border-primary/55' : 'border-border')}>
      <div className={cn('flex flex-wrap items-start', isUnassigned ? 'bg-muted/40' : 'bg-muted/60 dark:bg-muted/25')}>
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-label={`テーマ ${title} を${open ? '折りたたむ' : '展開する'}`}
          className="flex min-h-14 min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
            aria-hidden
          />
          <Layers className={cn('mt-0.5 h-4 w-4 shrink-0', isUnassigned ? 'text-muted-foreground' : 'text-primary')} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-extrabold leading-snug">{title}</span>
            {theme?.purpose ? (
              <span className="mt-0.5 block truncate text-[10.5px] font-normal text-muted-foreground">{theme.purpose}</span>
            ) : null}
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground">
              {activeCount > 0 ? (
                <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                  active {activeCount}
                </span>
              ) : null}
              {planningCount > 0 ? (
                <span className="rounded-md border border-violet-500/35 bg-violet-500/10 px-1.5 py-0.5 font-semibold text-violet-700 dark:text-violet-300">
                  planning {planningCount}
                </span>
              ) : null}
              <span>{planCount}計画</span>
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
              {liveCount > 0 ? <span aria-label={`稼働中${liveCount}件`}>● 稼働 {liveCount}</span> : null}
              {waitCount > 0 ? <span className="text-amber-700 dark:text-amber-300" aria-label={`確認待ち${waitCount}件`}>● 確認 {waitCount}</span> : null}
              {stepTotal > 0 ? <span>済 {stepDone}/{stepTotal}</span> : null}
            </span>
          </span>
        </button>
        {theme ? (
          <ThemeEditor
            theme={{
              id: theme.id,
              name: theme.name,
              purpose: theme.purpose,
              doneCriteria: theme.doneCriteria,
              goalRef: theme.goalRef,
            }}
            date={selectedDate}
            isPreview={isPreview}
            onThemeChange={handleThemeChange}
          />
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-border bg-muted/[0.04] p-2.5">
          {!isUnassigned ? (
            <div className="mb-2.5 flex flex-wrap items-start gap-2 px-0.5">
              <button
                type="button"
                onClick={() => showNextPhaseNotice('翌日へのTheme引継ぎ')}
                aria-describedby={phaseNotice ? `phase-notice-${group.key}` : undefined}
                className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                明日も継続
                <span className="font-normal text-muted-foreground/70">未保存</span>
              </button>
              <button
                type="button"
                onClick={() => showNextPhaseNotice('既存Planの追加・紐付け')}
                aria-describedby={phaseNotice ? `phase-notice-${group.key}` : undefined}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[11px] font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Planを追加
              </button>
            </div>
          ) : null}

          {phaseNotice ? (
            <p id={`phase-notice-${group.key}`} role="status" className="mb-2.5 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
              {phaseNotice}
            </p>
          ) : null}

          <div className={cn('grid gap-2.5', compact ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2')}>
            {plans.map((card) => (
              <PlanCardV2
                key={card.planSlug || `theme:${card.theme?.id ?? ''}`}
                data={card}
                selectedDate={selectedDate}
                aiTargets={aiTargets}
                onPreviewOnlyAction={showNextPhaseNotice}
                isPreview={isPreview}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
