'use client';

import { type DragEvent, type TextareaHTMLAttributes, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Layers, Pencil } from 'lucide-react';
import { ThemeEditor, type EditableTheme } from '@/app/dashboard/board/_components/theme-editor';
import type { Theme } from '@/lib/turso/themes';
import { cn } from '@/lib/utils';
import { PlanCardV2 } from './theme-card';
import type { ThemeGroup } from './types';

function AutoGrowingTextarea({ onInput, style, value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const element = ref.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  };

  useEffect(() => {
    resize();
  }, [value]);

  return (
    <textarea
      {...props}
      ref={ref}
      value={value}
      style={style}
      onInput={(event) => {
        resize();
        onInput?.(event);
      }}
    />
  );
}

// Theme → Plan → 工程 → AI の入口。
// V5では「現在の動き」を別レーンにせず、各Planカードの中へライブAI行を統合する。
// Themeは日次状態を持ち、未完了なら翌日へ自動継続する。PlanのTheme間移動は楽観UI＋version付きAPIで保存する。
export function ThemeGroupCard({
  group,
  selectedDate,
  aiTargets,
  defaultOpen = false,
  compact = false,
  isPreview = false,
  moveTargets = [],
  onMovePlan,
  onPlanDragStart,
  onPlanDragEnd,
  onThemeChange,
}: {
  group: ThemeGroup;
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
  defaultOpen?: boolean;
  compact?: boolean;
  isPreview?: boolean;
  moveTargets?: { id: string; name: string }[];
  onMovePlan?: (planSlug: string, targetThemeId: string) => Promise<void>;
  onPlanDragStart?: (planSlug: string, event: DragEvent<HTMLDivElement>) => void;
  onPlanDragEnd?: () => void;
  onThemeChange?: (theme: Theme) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [phaseNotice, setPhaseNotice] = useState('');
  const [themeOverride, setThemeOverride] = useState<Theme | null>(null);
  const [dayState, setDayState] = useState(group.dayState);
  const [dayVersion, setDayVersion] = useState(group.dayVersion);
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
  // Planが0件でもThemeの日次状態・目的・完了条件・Goalを確認/編集できるよう展開可能にする。
  const expandable = plans.length > 0 || Boolean(theme);
  const activeCount = plans.filter((plan) => plan.bucket === 'active').length;
  const planningCount = plans.filter((plan) => plan.bucket === 'planning').length;

  useEffect(() => {
    setDayState(group.dayState);
    setDayVersion(group.dayVersion);
  }, [group.dayState, group.dayVersion]);

  const showNextPhaseNotice = (action: string) => {
    setPhaseNotice(`${action}の保存は、UI確認後のDB接続段階で実装します。`);
  };

  const updateDayState = async () => {
    if (!theme || dayState === null || dayVersion === null || isPreview) return;
    const previousState = dayState;
    const previousVersion = dayVersion;
    const nextState = dayState === 'completed' ? 'active' : 'completed';
    setDayState(nextState);
    setPhaseNotice('日次状態を保存中…');
    try {
      const response = await fetch(`/api/board/themes/${encodeURIComponent(theme.id)}/day`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, state: nextState, expectedVersion: previousVersion }),
      });
      const json = await response.json();
      if (!response.ok || !json?.day) throw new Error('save failed');
      setDayVersion(json.day.version);
      setPhaseNotice(nextState === 'completed' ? '今日分を完了にしました。明日へは自動繰越しません。' : '今日のThemeとして再開しました。未完了なら明日へ自動繰越します。');
    } catch {
      setDayState(previousState);
      setDayVersion(previousVersion);
      setPhaseNotice('日次状態を保存できなかったため、元に戻しました。');
    }
  };

  const handleThemeChange = (next: EditableTheme) => {
    if (!theme) return;
    const updated: Theme = { ...theme, ...next };
    setThemeOverride(updated);
    onThemeChange?.(updated);
  };

  const themeEditor = theme ? (
    <ThemeEditor
      theme={{
        id: theme.id,
        name: theme.name,
        purpose: theme.purpose,
        doneCriteria: theme.doneCriteria,
        goalRef: theme.goalRef,
      }}
      isPreview={isPreview}
      onThemeChange={handleThemeChange}
    >
      {(editor) => {
        const metrics = (
          <span className="flex shrink-0 flex-col items-end gap-1.5 pr-1 text-right tabular-nums">
            <span className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  'text-[20px] font-extrabold leading-none',
                  stepPct === null ? 'text-muted-foreground' : stepPct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-700 dark:text-blue-300',
                )}
                aria-label={stepPct !== null ? `完了${stepPct}パーセント` : '進捗未設定'}
              >
                {stepPct !== null ? `${stepPct}%` : '—'}
              </span>
              {stepTotal > 0 ? <span className="text-[10px] font-medium text-muted-foreground">工程 {stepDone}/{stepTotal}</span> : null}
            </span>
            {stepTotal > 0 ? (
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted-foreground/20" aria-hidden>
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(stepPct ?? 0, 100)}%` }} />
              </span>
            ) : null}
            <span className="flex max-w-[250px] flex-wrap justify-end gap-1 text-[10px] text-muted-foreground">
              <span className="rounded-md border border-border/70 bg-background/70 px-1.5 py-0.5 font-semibold text-foreground">計画 {planCount}</span>
              {activeCount > 0 ? <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">active {activeCount}</span> : null}
              {planningCount > 0 ? <span className="rounded-md border border-violet-500/35 bg-violet-500/10 px-1.5 py-0.5 font-semibold text-violet-700 dark:text-violet-300">planning {planningCount}</span> : null}
              {liveCount > 0 ? <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300" aria-label={`稼働中${liveCount}件`}>稼働 {liveCount}</span> : null}
              {waitCount > 0 ? <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300" aria-label={`確認待ち${waitCount}件`}>確認 {waitCount}</span> : null}
            </span>
          </span>
        );

        const textFields = (
          <div className="min-w-[180px] flex-1 self-stretch space-y-1.5 py-0.5">
            <label className="block space-y-0.5">
              <span className="block text-[10px] font-semibold text-muted-foreground">内容</span>
              <input
                value={editor.draft.name}
                onChange={(event) => editor.updateDraft('name', event.target.value)}
                aria-label="内容"
                required
                className="h-6 w-full rounded border border-primary/45 bg-background/65 px-1.5 text-[15px] font-extrabold leading-snug outline-none ring-0 placeholder:text-muted-foreground/65 focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </label>
            <label className="block space-y-0.5">
              <span className="block text-[10px] font-semibold text-muted-foreground">目的</span>
              <AutoGrowingTextarea
                value={editor.draft.purpose}
                onChange={(event) => editor.updateDraft('purpose', event.target.value)}
                aria-label="目的"
                rows={1}
                placeholder="目的を入力"
                className="block min-h-5 w-full resize-none overflow-hidden rounded border border-primary/35 bg-background/50 px-1.5 py-0.5 text-[10.5px] leading-snug text-muted-foreground outline-none placeholder:text-muted-foreground/65 focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </label>
            <label className="block space-y-0.5">
              <span className="block text-[10px] font-semibold text-muted-foreground">完了条件</span>
              <AutoGrowingTextarea
                value={editor.draft.doneCriteria}
                onChange={(event) => editor.updateDraft('doneCriteria', event.target.value)}
                aria-label="完了条件"
                rows={1}
                placeholder="完了条件を入力"
                className="block min-h-5 w-full resize-none overflow-hidden rounded border border-primary/35 bg-background/50 px-1.5 py-0.5 text-[10.5px] leading-snug text-muted-foreground outline-none placeholder:text-muted-foreground/65 focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </label>
          </div>
        );

        if (!expandable) {
          return (
            <article className="overflow-hidden rounded-2xl border border-border/70 bg-card/60">
              {editor.editing ? (
                <form onSubmit={editor.save} className="flex min-h-14 flex-wrap items-start gap-2 px-3 py-2.5">
                  <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  {textFields}
                  <span className="shrink-0 pt-1 text-[10.5px] text-muted-foreground">今日は動きなし</span>
                  <div className="flex basis-full justify-end gap-1.5 border-t border-border/45 pt-2">
                    <button type="button" onClick={editor.cancelEditing} disabled={editor.saving} className="min-h-8 rounded-md border border-border px-2.5 text-[10.5px] text-muted-foreground">やめる</button>
                    <button type="submit" disabled={editor.saving} className="min-h-8 rounded-md bg-primary px-3 text-[10.5px] font-semibold text-primary-foreground disabled:opacity-60">{editor.saving ? '保存中…' : '保存'}</button>
                  </div>
                  {editor.error ? <p role="alert" className="basis-full text-[10.5px] text-destructive">{editor.error}</p> : null}
                </form>
              ) : (
                <div className="flex min-h-14 flex-wrap items-center gap-2 px-3 py-2.5">
                  <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[13.5px] font-semibold leading-snug text-muted-foreground">{title}</h2>
                    {theme?.purpose ? <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground/80">{theme.purpose}</p> : null}
                    <span className="mt-1 flex flex-wrap gap-1 text-[9.5px] font-semibold">
                      {dayState ? <span className={cn('rounded border px-1.5 py-0.5', dayState === 'active' ? 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300' : dayState === 'completed' ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border text-muted-foreground')}>{dayState === 'active' ? '今日実行' : dayState === 'completed' ? '今日分完了' : '今日は見送り'}</span> : null}
                      {group.carriedFromDay ? <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-700 dark:text-violet-300">前日から繰越</span> : null}
                    </span>
                  </div>
                  <span className="shrink-0 text-[10.5px] text-muted-foreground">今日は動きなし</span>
                  <button type="button" onClick={editor.startEditing} aria-label={`テーマ「${theme.name}」を編集`} title="テーマを編集" className="m-1 inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Pencil className="h-3.5 w-3.5" /></button>
                </div>
              )}
            </article>
          );
        }

        return (
          <article className={cn('overflow-hidden rounded-2xl border bg-card', open ? 'border-primary/55' : 'border-border')}>
            <div className={cn('flex flex-wrap items-start', isUnassigned ? 'bg-muted/40' : 'bg-muted/60 dark:bg-muted/25')}>
              {editor.editing ? (
                <form onSubmit={editor.save} className="flex min-h-[72px] min-w-0 flex-1 flex-wrap items-start gap-2 px-3 py-2.5">
                  <button type="button" onClick={() => setOpen((previous) => !previous)} aria-label={`テーマ ${title} を${open ? '折りたたむ' : '展開する'}`} className="mt-0.5 grid h-5 w-4 shrink-0 place-items-center text-muted-foreground">
                    <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} aria-hidden />
                  </button>
                  <Layers className={cn('mt-0.5 h-4 w-4 shrink-0', isUnassigned ? 'text-muted-foreground' : 'text-primary')} aria-hidden />
                  {textFields}
                  {metrics}
                  <div className="flex basis-full items-center justify-end gap-1.5 border-t border-border/45 pt-2">
                    {editor.error ? <p role="alert" className="mr-auto text-[10.5px] text-destructive">{editor.error}</p> : null}
                    <button type="button" onClick={editor.cancelEditing} disabled={editor.saving} className="min-h-8 rounded-md border border-border px-2.5 text-[10.5px] text-muted-foreground">やめる</button>
                    <button type="submit" disabled={editor.saving} className="min-h-8 rounded-md bg-primary px-3 text-[10.5px] font-semibold text-primary-foreground disabled:opacity-60">{editor.saving ? '保存中…' : '保存'}</button>
                  </div>
                </form>
              ) : (
                <>
                  <button type="button" onClick={() => setOpen((previous) => !previous)} aria-expanded={open} aria-label={`テーマ ${title} を${open ? '折りたたむ' : '展開する'}`} className="flex min-h-[72px] min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
                    <Layers className={cn('h-4 w-4 shrink-0 self-start pt-0.5', isUnassigned ? 'text-muted-foreground' : 'text-primary')} aria-hidden />
                    <span className="min-w-0 flex-1 self-start">
                      <span className="block truncate text-[15px] font-extrabold leading-snug">{title}</span>
                      {theme?.purpose ? <span className="mt-0.5 block truncate text-[10.5px] font-normal text-muted-foreground">{theme.purpose}</span> : null}
                      {plans.length === 0 ? <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground/75">今日は動きなし</span> : null}
                      <span className="mt-1 flex flex-wrap gap-1 text-[9.5px] font-semibold">
                        {dayState ? <span className={cn('rounded border px-1.5 py-0.5', dayState === 'active' ? 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300' : dayState === 'completed' ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border text-muted-foreground')}>{dayState === 'active' ? '今日実行' : dayState === 'completed' ? '今日分完了' : '今日は見送り'}</span> : null}
                        {group.carriedFromDay ? <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-700 dark:text-violet-300">前日から繰越</span> : null}
                      </span>
                    </span>
                    {metrics}
                  </button>
                  <button type="button" onClick={editor.startEditing} aria-label={`テーマ「${theme.name}」を編集`} title="テーマを編集" className="m-2 inline-grid h-9 w-9 shrink-0 place-items-center self-start rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Pencil className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>

            {open && !editor.editing ? (
        <div className="border-t border-border bg-muted/[0.04] p-2.5">
          {!isUnassigned ? (
            <div className="mb-2.5 flex flex-wrap items-start gap-2 px-0.5">
              <button
                type="button"
                onClick={() => void updateDayState()}
                aria-describedby={phaseNotice ? `phase-notice-${group.key}` : undefined}
                disabled={dayState === null || dayVersion === null || isPreview}
                className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                {dayState === 'completed' ? '今日のThemeへ戻す' : '今日分を完了'}
              </button>
              <span className="self-center text-[10px] text-muted-foreground">未完了のThemeは翌日に自動継続</span>
            </div>
          ) : null}

          {phaseNotice ? (
            <p id={`phase-notice-${group.key}`} role="status" className="mb-2.5 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
              {phaseNotice}
            </p>
          ) : null}

          {theme && (theme.purpose || theme.doneCriteria) ? (
            <dl className="mb-2.5 grid gap-1 rounded-lg border border-border/60 bg-background/55 px-2.5 py-2 text-[10.5px] leading-relaxed">
              {theme.purpose ? <div className="grid grid-cols-[52px_1fr] gap-2"><dt className="font-semibold text-muted-foreground">目的</dt><dd>{theme.purpose}</dd></div> : null}
              {theme.doneCriteria ? <div className="grid grid-cols-[52px_1fr] gap-2"><dt className="font-semibold text-muted-foreground">完了条件</dt><dd>{theme.doneCriteria}</dd></div> : null}
            </dl>
          ) : null}

          <div className={cn('grid gap-2.5', compact ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2')}>
            {plans.map((card) => (
              <div
                key={card.planSlug || `theme:${card.theme?.id ?? ''}`}
                draggable={!isPreview && Boolean(card.planSlug)}
                onDragStart={(event) => card.planSlug && onPlanDragStart?.(card.planSlug, event)}
                onDragEnd={onPlanDragEnd}
                className={cn(card.planSlug && !isPreview && 'cursor-grab active:cursor-grabbing')}
              >
                <PlanCardV2
                  data={card}
                  selectedDate={selectedDate}
                  aiTargets={aiTargets}
                  onPreviewOnlyAction={isPreview ? showNextPhaseNotice : undefined}
                  isPreview={isPreview}
                />
                {!isPreview && card.planSlug && moveTargets.length > 1 ? (
                  <label className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                    <span>テーマへ移動</span>
                    <select
                      aria-label={`${card.planTitle}を別のテーマへ移動`}
                      value={theme?.id ?? ''}
                      onChange={(event) => {
                        const target = event.target.value;
                        if (target && target !== theme?.id) void onMovePlan?.(card.planSlug, target);
                      }}
                      className="min-h-9 max-w-40 rounded-md border border-border bg-background px-2 text-[10.5px] text-foreground"
                    >
                      {moveTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            ))}
          </div>
        </div>
            ) : null}
          </article>
        );
      }}
    </ThemeEditor>
  ) : null;

  if (themeEditor) return themeEditor;

  return (
    <article className="overflow-hidden rounded-2xl border border-border/70 bg-card/60">
      <div className="flex min-h-14 items-center gap-2 px-3 py-2.5">
        <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13.5px] font-semibold leading-snug text-muted-foreground">{title}</h2>
        </div>
        <span className="shrink-0 text-[10.5px] text-muted-foreground">今日は動きなし</span>
      </div>
    </article>
  );
}
