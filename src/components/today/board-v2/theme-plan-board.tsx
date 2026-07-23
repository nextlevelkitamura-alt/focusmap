'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { ThemeGroupCard } from './theme-group';
import type { Theme } from '@/lib/turso/themes';
import type { PlanCardData, ThemeGroup } from './types';

function repoLabel(raw: string) {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'focusmap') return 'Focusmap';
  if (normalized === 'shigoto' || normalized === '仕事') return '仕事';
  if (normalized === 'ai-platform' || normalized === 'aiエージェント基盤' || normalized === 'ai基盤') return 'AI基盤';
  return raw.trim();
}

function planRepo(card: PlanCardData) {
  const taskRepo = card.tasks.find((task) => task.repoName)?.repoName;
  const sessionRepo = [...card.tasks.flatMap((task) => task.sessions), ...card.cardSessions]
    .find((item) => item.session.repo)?.session.repo;
  return repoLabel(taskRepo || sessionRepo || '');
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function belongsToProject(card: PlanCardData, projectRepoPath?: string | null) {
  if (!projectRepoPath) return true;
  const planPath = normalizePath(card.repoPath);
  const repoPath = normalizePath(projectRepoPath);
  return Boolean(planPath && repoPath && (planPath === repoPath || planPath.startsWith(`${repoPath}/`)));
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

export function ThemePlanBoard({
  groups,
  selectedDate,
  aiTargets,
  compact = false,
  isPreview = false,
  projectRepoPath,
  onThemeChange,
}: {
  groups: ThemeGroup[];
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
  compact?: boolean;
  isPreview?: boolean;
  projectRepoPath?: string | null;
  onThemeChange?: (theme: Theme) => void;
}) {
  const [selectedRepo, setSelectedRepo] = useState('すべて');
  const projectGroups = useMemo(
    // 開発サンプルには実在するplan_docs.pathが無い。workspaceのpath照合をかけると
    // 完成形の確認そのものが0件になるため、サンプル表示時だけは全Themeをそのまま描画する。
    () => projectRepoPath && !isPreview
      ? groups
        .map((group) => rebuildGroup(group, group.plans.filter((plan) => belongsToProject(plan, projectRepoPath))))
        .filter((group) => group.plans.length > 0)
      : groups,
    [groups, isPreview, projectRepoPath],
  );
  const repoOptions = useMemo(
    () => ['すべて', ...Array.from(new Set(projectGroups.flatMap((group) => group.plans).map(planRepo).filter(Boolean)))],
    [projectGroups],
  );
  const filteredGroups = useMemo(() => {
    if (selectedRepo === 'すべて') return projectGroups;
    return projectGroups
      .map((group) => rebuildGroup(group, group.plans.filter((plan) => planRepo(plan) === selectedRepo)))
      .filter((group) => group.plans.length > 0);
  }, [projectGroups, selectedRepo]);
  const visiblePlanCount = filteredGroups.reduce((total, group) => total + group.planCount, 0);
  const totalPlanCount = projectGroups.reduce((total, group) => total + group.planCount, 0);

  return (
    <div className="space-y-3">
      <div className={cn('flex gap-2', compact ? 'flex-col items-stretch' : 'flex-wrap items-center justify-between')}>
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium text-muted-foreground">対象リポジトリ（表示フィルター）</p>
          <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground/75">
            {visiblePlanCount}/{totalPlanCount} Plan表示中
          </p>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-0.5" role="group" aria-label="対象リポジトリ">
          {repoOptions.map((repo) => {
            const selected = selectedRepo === repo;
            return (
              <button
                key={repo}
                type="button"
                onClick={() => setSelectedRepo(repo)}
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

      {filteredGroups.length > 0 ? (
        <div className="space-y-3.5">
          {filteredGroups.map((group, index) => (
            <ThemeGroupCard
              key={group.key}
              group={group}
              selectedDate={selectedDate}
              aiTargets={aiTargets}
              defaultOpen={index === 0 && group.hasActivity}
              compact={compact}
              isPreview={isPreview}
              onThemeChange={onThemeChange}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
          このリポジトリに紐づくPlanはありません。
        </p>
      )}
    </div>
  );
}
