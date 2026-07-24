'use client';

import { Check, Plus, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { ThemeGroupCard } from './theme-group';
import type { ThemeCandidate } from '@/lib/turso/theme-candidates';
import type { DailyTheme, Theme, ThemePlanLink } from '@/lib/turso/themes';
import type { PlanCardData, ThemeGroup } from './types';

function repoLabel(raw: string) {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'focusmap') return 'Focusmap';
  if (normalized === 'shigoto' || normalized === '仕事') return '仕事';
  if (normalized === 'ai-platform' || normalized === 'aiエージェント基盤' || normalized === 'ai基盤') return 'AI基盤';
  if (normalized === 'private') return 'Private';
  return raw.trim();
}

function planRepo(card: PlanCardData) {
  const taskRepo = card.tasks.find((task) => task.repoName)?.repoName;
  const sessionRepo = [...card.tasks.flatMap((task) => task.sessions), ...card.cardSessions]
    .find((item) => item.session.repo)?.session.repo;
  return repoLabel(taskRepo || sessionRepo || '');
}

function themeRepos(group: ThemeGroup) {
  return (group.theme?.repoSlugs ?? []).map(repoLabel).filter(Boolean);
}

function planHasActivity(card: PlanCardData) {
  return card.tasks.length > 0 || card.cardSessions.length > 0 || card.finishedTodos.length > 0 || card.finishedLogs.length > 0;
}

function rebuildGroup(group: ThemeGroup, plans: PlanCardData[]): ThemeGroup {
  let stepDone = 0;
  let stepTotal = 0;
  let liveCount = 0;
  let waitCount = 0;
  let hasActivity = false;

  for (const card of plans) {
    const progress = card.planSlug === '' ? card.progress : card.stepProgress;
    stepDone += progress?.done ?? 0;
    stepTotal += progress?.total ?? 0;
    liveCount += card.liveCount;
    waitCount += card.waitCount;
    if (planHasActivity(card)) hasActivity = true;
  }

  return {
    ...group,
    plans,
    planCount: plans.filter((card) => card.planSlug !== '').length,
    stepDone,
    stepTotal,
    stepPct: stepTotal > 0 ? Math.round((100 * stepDone) / stepTotal) : null,
    liveCount,
    waitCount,
    hasActivity,
  };
}

function groupFromTheme(theme: DailyTheme): ThemeGroup {
  return {
    key: theme.id,
    theme,
    title: theme.name,
    plans: [],
    planCount: 0,
    stepDone: 0,
    stepTotal: 0,
    stepPct: null,
    liveCount: 0,
    waitCount: 0,
    hasActivity: false,
    dayState: theme.dayState,
    carriedFromDay: theme.carriedFromDay,
    dayVersion: theme.dayVersion,
  };
}

function repoSlugFromLabel(label: string) {
  if (label === 'Focusmap') return 'focusmap';
  if (label === 'AI基盤') return 'ai-platform';
  if (label === '仕事') return 'shigoto';
  if (label === 'Private') return 'private';
  return '';
}

export function ThemePlanBoard({
  groups,
  selectedDate,
  aiTargets,
  compact = false,
  isPreview = false,
  selectedRepo,
  showRepoFilter = true,
  onThemeChange,
}: {
  groups: ThemeGroup[];
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
  compact?: boolean;
  isPreview?: boolean;
  projectRepoPath?: string | null;
  selectedRepo?: string;
  showRepoFilter?: boolean;
  onThemeChange?: (theme: Theme) => void;
}) {
  const [internalSelectedRepo, setInternalSelectedRepo] = useState('すべて');
  const [localGroups, setLocalGroups] = useState(groups);
  const [draggedPlan, setDraggedPlan] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newThemeName, setNewThemeName] = useState('');
  const [newThemePurpose, setNewThemePurpose] = useState('');
  const [newThemeDoneCriteria, setNewThemeDoneCriteria] = useState('');
  const [themeActionNotice, setThemeActionNotice] = useState('');
  const [savingTheme, setSavingTheme] = useState(false);
  const [candidates, setCandidates] = useState<ThemeCandidate[]>([]);
  useEffect(() => setLocalGroups(groups), [groups]);
  const activeRepo = selectedRepo ?? internalSelectedRepo;
  // Dailyヘッダーのrepoチップが表示範囲の正本。上部workspace/projectを変えても
  // 「すべて」では横断Themeを見渡せるよう、projectRepoPathで二重に落とさない。
  const projectGroups = localGroups;
  const repoOptions = useMemo(
    () => ['すべて', ...Array.from(new Set(projectGroups.flatMap((group) => [
      ...themeRepos(group),
      ...group.plans.map(planRepo).filter(Boolean),
    ])))],
    [projectGroups],
  );
  const filteredGroups = useMemo(() => {
    if (activeRepo === 'すべて') return projectGroups;
    return projectGroups
      .map((group) => rebuildGroup(group, group.plans.filter((plan) => planRepo(plan) === activeRepo)))
      .filter((group) => group.plans.length > 0 || themeRepos(group).includes(activeRepo));
  }, [activeRepo, projectGroups]);
  const visiblePlanCount = filteredGroups.reduce((total, group) => total + group.planCount, 0);
  const totalPlanCount = projectGroups.reduce((total, group) => total + group.planCount, 0);
  const moveTargets = useMemo(
    () => localGroups.flatMap((group) => group.theme ? [{ id: group.theme.id, name: group.theme.name }] : []),
    [localGroups],
  );

  useEffect(() => {
    if (isPreview) return;
    let cancelled = false;
    fetch('/api/board/theme-candidates')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('load failed')))
      .then((json) => {
        if (!cancelled && Array.isArray(json?.candidates)) setCandidates(json.candidates as ThemeCandidate[]);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [isPreview]);

  const createTheme = useCallback(async () => {
    const name = newThemeName.trim();
    if (!name || savingTheme || isPreview) return;
    setSavingTheme(true);
    setThemeActionNotice('Themeを追加中…');
    try {
      const response = await fetch('/api/board/themes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          name,
          purpose: newThemePurpose.trim(),
          completionCriteria: newThemeDoneCriteria.split('\n').map((criterion) => criterion.trim()).filter(Boolean),
          repoSlugs: [repoSlugFromLabel(activeRepo)].filter(Boolean),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.theme) throw new Error('save failed');
      const created = json.theme as DailyTheme;
      setLocalGroups((current) => current.some((group) => group.key === created.id) ? current : [...current, groupFromTheme(created)]);
      setNewThemeName('');
      setNewThemePurpose('');
      setNewThemeDoneCriteria('');
      setShowCreate(false);
      setThemeActionNotice('今日のThemeへ追加しました。未完了なら明日へ自動で繰り越します。');
    } catch {
      setThemeActionNotice('Themeを保存できませんでした。入力内容は残しています。');
    } finally {
      setSavingTheme(false);
    }
  }, [activeRepo, isPreview, newThemeDoneCriteria, newThemeName, newThemePurpose, savingTheme, selectedDate]);

  const decideCandidate = useCallback(async (candidate: ThemeCandidate, action: 'adopt' | 'reject') => {
    if (isPreview) return;
    const before = candidates;
    setCandidates((current) => current.filter((item) => item.id !== candidate.id));
    setThemeActionNotice(action === 'adopt' ? 'AI候補を今日のThemeへ採用中…' : 'AI候補を見送り中…');
    try {
      const response = await fetch(`/api/board/theme-candidates/${encodeURIComponent(candidate.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, date: selectedDate }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error('save failed');
      if (action === 'adopt' && json?.theme) {
        const adopted = json.theme as DailyTheme;
        setLocalGroups((current) => current.some((group) => group.key === adopted.id) ? current : [...current, groupFromTheme(adopted)]);
        setThemeActionNotice('AI候補を今日のThemeへ採用しました。');
      } else {
        setThemeActionNotice('AI候補を今回は見送りました。');
      }
    } catch {
      setCandidates(before);
      setThemeActionNotice('候補の更新に失敗したため、元に戻しました。');
    }
  }, [candidates, isPreview, selectedDate]);

  const movePlan = useCallback(async (planSlug: string, targetThemeId: string) => {
    if (!planSlug || isPreview) return;
    const before = localGroups;
    const source = before.find((group) => group.plans.some((plan) => plan.planSlug === planSlug));
    const target = before.find((group) => group.theme?.id === targetThemeId);
    if (!source || !target || source.key === target.key || !target.theme) return;
    const card = source.plans.find((plan) => plan.planSlug === planSlug);
    if (!card) return;
    const existingLink = source.theme?.planLinks?.find((link) => link.planSlug === planSlug) ?? null;
    if (source.theme && !existingLink) {
      setMoveError('Plan紐付けの更新情報がまだ読み込まれていません。数秒後にもう一度お試しください。');
      return;
    }

    const optimistic = before.map((group) => {
      if (group.key === source.key) return rebuildGroup(group, group.plans.filter((plan) => plan.planSlug !== planSlug));
      if (group.key === target.key) return rebuildGroup(group, [...group.plans, { ...card, theme: target.theme }]);
      return group;
    });
    setMoveError('');
    setLocalGroups(optimistic);

    try {
      const response = await fetch(`/api/board/themes/${encodeURIComponent(targetThemeId)}/plans`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planSlug,
          expected: existingLink ? { themeId: existingLink.themeId, version: existingLink.version } : null,
          repoSlug: planRepo(card) || null,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.link) throw new Error(`HTTP ${response.status}`);
      const savedLink = json.link as ThemePlanLink;
      setLocalGroups((current) => current.map((group) => {
        if (!group.theme || (group.key !== source.key && group.key !== target.key)) return group;
        const planLinks = (group.theme.planLinks ?? []).filter((link) => link.planSlug !== planSlug);
        if (group.key === target.key) planLinks.push(savedLink);
        const nextTheme = { ...group.theme, planLinks, planRefs: planLinks.map((link) => link.planSlug) };
        return {
          ...group,
          theme: nextTheme,
          plans: group.plans.map((plan) => plan.planSlug === planSlug ? { ...plan, theme: nextTheme } : plan),
        };
      }));
    } catch {
      setLocalGroups(before);
      setMoveError('Themeへの移動を保存できなかったため、元の位置に戻しました。');
    }
  }, [isPreview, localGroups]);

  return (
    <div className="space-y-3">
      {!isPreview ? (
        <div className="space-y-2 rounded-xl border border-border/55 bg-muted/[0.04] p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10.5px] font-semibold text-muted-foreground">今日のTheme</p>
            <button
              type="button"
              onClick={() => setShowCreate((current) => !current)}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border/70 bg-background px-2 text-[10.5px] font-semibold text-foreground transition-colors hover:bg-muted"
              aria-expanded={showCreate}
            >
              <Plus className="h-3.5 w-3.5" />
              Themeを追加
            </button>
          </div>
          {showCreate ? (
            <form
              className="space-y-1.5 rounded-lg border border-primary/30 bg-background/70 p-2"
              onSubmit={(event) => { event.preventDefault(); void createTheme(); }}
            >
              <label className="block space-y-1">
                <span className="block text-[10px] font-semibold text-muted-foreground">内容</span>
                <input
                  autoFocus
                  value={newThemeName}
                  onChange={(event) => setNewThemeName(event.target.value)}
                  aria-label="内容"
                  placeholder="今日向き合うTheme"
                  className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs font-semibold outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
              </label>
              <label className="block space-y-1">
                <span className="block text-[10px] font-semibold text-muted-foreground">目的</span>
                <textarea
                  value={newThemePurpose}
                  onChange={(event) => setNewThemePurpose(event.target.value)}
                  aria-label="目的"
                  placeholder="何を良くするためのThemeか"
                  rows={2}
                  className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[11px] leading-4 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
              </label>
              <label className="block space-y-1">
                <span className="block text-[10px] font-semibold text-muted-foreground">完了条件</span>
                <textarea
                  value={newThemeDoneCriteria}
                  onChange={(event) => setNewThemeDoneCriteria(event.target.value)}
                  aria-label="完了条件"
                  placeholder="1行に1つずつ、完了条件を入力"
                  rows={2}
                  className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[11px] leading-4 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
              </label>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">{activeRepo === 'すべて' ? 'リポ未指定' : `${activeRepo}に紐付け`}</span>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setShowCreate(false)} className="min-h-8 rounded-md border border-border px-2.5 text-[10.5px] text-muted-foreground">やめる</button>
                  <button type="submit" disabled={!newThemeName.trim() || savingTheme} className="min-h-8 rounded-md bg-primary px-3 text-[10.5px] font-semibold text-primary-foreground disabled:opacity-50">{savingTheme ? '保存中…' : '追加'}</button>
                </div>
              </div>
            </form>
          ) : null}
          {candidates.length > 0 ? (
            <div className="space-y-1.5 rounded-lg border border-violet-500/25 bg-violet-500/[0.06] p-2" aria-label="AIからのTheme候補">
              <p className="flex items-center gap-1 text-[10.5px] font-semibold text-violet-700 dark:text-violet-300"><Sparkles className="h-3.5 w-3.5" />AIからTheme候補</p>
              {candidates.map((candidate) => (
                <div key={candidate.id} className="flex items-start gap-2 rounded-md border border-border/55 bg-background/75 p-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-semibold leading-4 text-foreground">{candidate.name}</p>
                    {candidate.purpose ? <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{candidate.purpose}</p> : null}
                    {candidate.repoSlug ? <span className="mt-1 inline-block rounded border border-border/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">{repoLabel(candidate.repoSlug)}</span> : null}
                  </div>
                  <button type="button" onClick={() => void decideCandidate(candidate, 'adopt')} aria-label={`${candidate.name}を採用`} title="今日のThemeに採用" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><Check className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => void decideCandidate(candidate, 'reject')} aria-label={`${candidate.name}を見送る`} title="今回は見送る" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          ) : null}
          {themeActionNotice ? <p aria-live="polite" className="text-[10px] text-muted-foreground">{themeActionNotice}</p> : null}
        </div>
      ) : null}
      {showRepoFilter ? (
      <div className={cn('flex gap-2', compact ? 'flex-col items-stretch' : 'flex-wrap items-center justify-between')}>
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium text-muted-foreground">対象リポジトリ（表示フィルター）</p>
          <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground/75">
            {visiblePlanCount}/{totalPlanCount} Plan表示中
          </p>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-0.5" role="group" aria-label="対象リポジトリ">
          {repoOptions.map((repo) => {
            const selected = activeRepo === repo;
            return (
              <button
                key={repo}
                type="button"
                onClick={() => setInternalSelectedRepo(repo)}
                aria-pressed={selected}
                className={cn(
                  'min-h-11 shrink-0 rounded-lg border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {repo}
              </button>
            );
          })}
        </div>
      </div>
      ) : null}

      {filteredGroups.length > 0 ? (
        <div className="space-y-3.5">
          {filteredGroups.map((group) => (
            <div
              key={group.key}
              onDragOver={(event) => {
                if (!group.theme || !draggedPlan) return;
                event.preventDefault();
                setDropTarget(group.key);
              }}
              onDragLeave={() => setDropTarget((current) => current === group.key ? null : current)}
              onDrop={(event) => {
                event.preventDefault();
                const planSlug = event.dataTransfer.getData('text/focusmap-plan') || draggedPlan;
                setDropTarget(null);
                setDraggedPlan(null);
                if (planSlug && group.theme) void movePlan(planSlug, group.theme.id);
              }}
              className={cn(dropTarget === group.key && 'rounded-2xl ring-2 ring-primary ring-offset-2 ring-offset-background')}
            >
              <ThemeGroupCard
                group={group}
                selectedDate={selectedDate}
                aiTargets={aiTargets}
                defaultOpen={false}
                compact={compact}
                isPreview={isPreview}
                moveTargets={moveTargets}
                onMovePlan={movePlan}
                onPlanDragStart={(planSlug, event) => {
                  setDraggedPlan(planSlug);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/focusmap-plan', planSlug);
                }}
                onPlanDragEnd={() => {
                  setDraggedPlan(null);
                  setDropTarget(null);
                }}
                onThemeChange={onThemeChange}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
          このリポジトリに紐づくTheme・Planはありません。
        </p>
      )}
      {moveError ? <p role="alert" className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">{moveError}</p> : null}
    </div>
  );
}
