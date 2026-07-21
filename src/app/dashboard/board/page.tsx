import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { createClient } from '@/utils/supabase/server';
import { cn } from '@/lib/utils';
import {
  getCurrentSessions,
  getDailyTotals,
  getFinishedLogs,
  getStuckWait,
  type CurrentSession,
  type DailyTotals,
  type FinishedLog,
  type StuckWait,
} from '@/lib/turso/personal-os-board';
import { getRepos, getTodosForDate, type Repo, type Todo } from '@/lib/turso/todos';
import {
  getStepAggregatesForDate,
  getStepsForDate,
  getTodoTimesForDate,
  type TodoStep,
  type TodoStepAggregate,
  type TodoTimes,
} from '@/lib/turso/todo-steps';
import {
  getActiveThemes,
  getThemeProgressForDate,
  type Theme,
  type ThemeProgress,
} from '@/lib/turso/themes';
import { getSubagentsBySession, type SessionSubagent } from '@/lib/turso/session-subagents';
import {
  getActivePlans,
  getPlanSlugsForDate,
  getPlanStepProgress,
  getResolvablePlanSlugs,
  type ActivePlan,
  type PlanStepProgress,
} from '@/lib/turso/plan-links';
import { BoardPoller } from './_components/board-poller';
import { UndoBar } from './_components/undo-bar';
import { BoardPaneSwitch } from '@/components/today/board-pane-switch';
import { PlanCardV2 } from '@/components/today/board-v2/theme-card';
import { DayHeader } from '@/components/today/board-v2/day-header';
import { StrayBox } from '@/components/today/board-v2/stray-box';
import { buildBoardV2Data } from '@/components/today/board-v2/build';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ date?: string; added?: string; addError?: string; justCompleted?: string }>;
}

type DataSource = 'board' | 'inbox';

interface LoadResult<T> {
  data: T;
  error: DataSource | null;
}

const EMPTY_TOTALS: DailyTotals = { sessionDate: '', runMin: 0, waitMin: 0, subMin: 0, sessions: 0 };

function getJstDate() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function isDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function shiftDate(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function formatDateLabel(date: string, isToday: boolean) {
  const [, month, day] = date.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('ja-JP', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
  return `${month}/${day}（${weekday}）${isToday ? ' 今日' : ''}`;
}

function buildDateHref(date: string) {
  return `/dashboard/board?${new URLSearchParams({ date }).toString()}`;
}

async function load<T>(source: DataSource, fallback: T, getter: () => Promise<T>): Promise<LoadResult<T>> {
  try {
    return { data: await getter(), error: null };
  } catch {
    return { data: fallback, error: source };
  }
}

export default async function TodayBoardPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const today = getJstDate();
  const selectedDate = isDate(params.date) ? params.date : today;
  const isToday = selectedDate === today;

  const [
    reposResult,
    todosResult,
    stepsResult,
    aggResult,
    timesResult,
    themesResult,
    themeProgressResult,
    totalsResult,
    logsResult,
    currentResult,
    stuckResult,
    subagentsResult,
    planSlugsResult,
    resolvablePlansResult,
    activePlansResult,
    planStepProgressResult,
  ] = await Promise.all([
    load('inbox', [] as Repo[], () => getRepos()),
    load('inbox', [] as Todo[], () => getTodosForDate(selectedDate)),
    load('inbox', [] as TodoStep[], () => getStepsForDate(selectedDate)),
    load('inbox', new Map<string, TodoStepAggregate>(), () => getStepAggregatesForDate(selectedDate)),
    load('inbox', new Map<string, TodoTimes>(), () => getTodoTimesForDate(selectedDate)),
    load('inbox', [] as Theme[], () => getActiveThemes()),
    load('inbox', new Map<string, ThemeProgress>(), () => getThemeProgressForDate(selectedDate)),
    load('board', EMPTY_TOTALS, () => getDailyTotals(selectedDate)),
    load('board', [] as FinishedLog[], () => getFinishedLogs(selectedDate)),
    isToday
      ? load('board', [] as CurrentSession[], () => getCurrentSessions())
      : Promise.resolve({ data: [] as CurrentSession[], error: null } as LoadResult<CurrentSession[]>),
    isToday
      ? load('board', [] as StuckWait[], () => getStuckWait(0))
      : Promise.resolve({ data: [] as StuckWait[], error: null } as LoadResult<StuckWait[]>),
    isToday
      ? load('board', new Map<string, SessionSubagent[]>(), () => getSubagentsBySession(selectedDate))
      : Promise.resolve({ data: new Map<string, SessionSubagent[]>(), error: null } as LoadResult<Map<string, SessionSubagent[]>>),
    load('inbox', new Map<string, string>(), () => getPlanSlugsForDate(selectedDate)),
    load('inbox', new Set<string>(), () => getResolvablePlanSlugs()),
    load('inbox', [] as ActivePlan[], () => getActivePlans()),
    load('inbox', new Map<string, PlanStepProgress>(), () => getPlanStepProgress()),
  ]);

  const errors = new Set(
    [
      reposResult.error,
      todosResult.error,
      stepsResult.error,
      aggResult.error,
      timesResult.error,
      themesResult.error,
      themeProgressResult.error,
      totalsResult.error,
      logsResult.error,
      currentResult.error,
      stuckResult.error,
      subagentsResult.error,
    ].filter((error): error is DataSource => error !== null),
  );

  const repoNameBySlug = new Map(reposResult.data.map((repo) => [repo.slug, repo.name]));
  const stuckBySession = new Map(stuckResult.data.map((stuck) => [stuck.sessionKey, stuck]));

  // ステップを todo_id ごとにまとめる。
  const stepsByTodo = new Map<string, TodoStep[]>();
  for (const step of stepsResult.data) {
    const list = stepsByTodo.get(step.todoId) ?? [];
    list.push(step);
    stepsByTodo.set(step.todoId, list);
  }

  const todos = todosResult.data;
  const board = buildBoardV2Data({
    selectedDate,
    isToday,
    todos,
    stepsByTodo,
    aggByTodo: aggResult.data,
    timesByTodo: timesResult.data,
    activeThemes: themesResult.data,
    themeProgress: themeProgressResult.data,
    totals: totalsResult.data,
    finishedLogs: logsResult.data,
    currentSessions: currentResult.data,
    stuckBySession,
    subagentsBySession: subagentsResult.data,
    repoNameBySlug,
    planSlugByTodo: planSlugsResult.data,
    resolvablePlanSlugs: resolvablePlansResult.data,
    activePlans: activePlansResult.data,
    planStepProgress: planStepProgressResult.data,
  });

  const justCompletedId =
    params.justCompleted &&
    todos.some((todo) => todo.id === params.justCompleted && todo.assignee === 'ai' && todo.status === 'done')
      ? params.justCompleted
      : null;

  const strayHasContent =
    board.stray.tasks.length > 0 ||
    board.stray.sessions.length > 0 ||
    board.stray.finishedTodos.length > 0 ||
    board.stray.finishedLogs.length > 0;
  const isEmpty = board.planCards.length === 0 && !strayHasContent;

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto pb-20">
      {isToday ? <BoardPoller /> : null}

      <div className="mx-auto w-full max-w-2xl space-y-4 px-3 py-4 xl:max-w-6xl">
        <BoardPaneSwitch active="board" />

        <DayHeader
          dateLabel={formatDateLabel(selectedDate, isToday)}
          prevHref={buildDateHref(shiftDate(selectedDate, -1))}
          nextHref={buildDateHref(shiftDate(selectedDate, 1))}
          progressPct={board.progressPct}
          liveTotal={board.liveTotal}
          waitTotal={board.waitTotal}
          runMin={board.runMin}
        />

        {errors.size > 0 ? (
          <Card className="border-dashed">
            <CardContent className="space-y-1 p-4 text-sm text-muted-foreground">
              {errors.has('inbox') ? <p>やること箱には PERSONAL_OS_INBOX_* の接続設定が必要です。</p> : null}
              {errors.has('board') ? <p>エージェント・サマリには PERSONAL_OS_BOARD_* の接続設定が必要です。</p> : null}
              <p>接続できたデータだけで画面を表示しています。</p>
            </CardContent>
          </Card>
        ) : null}

        {params.addError === '1' ? (
          <p role="alert" className="text-sm text-destructive">
            追加できませんでした。入力内容とDB接続設定を確認してください。
          </p>
        ) : null}

        {justCompletedId ? <UndoBar todoId={justCompletedId} date={selectedDate} /> : null}

        {board.planCards.length > 0 ? (
          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
            {board.planCards.map((card) => (
              <PlanCardV2
                key={card.planSlug || `theme:${card.theme?.id ?? ''}`}
                data={card}
                selectedDate={selectedDate}
                aiTargets={board.aiTargets}
              />
            ))}
          </div>
        ) : null}

        {strayHasContent ? (
          <StrayBox stray={board.stray} selectedDate={selectedDate} aiTargets={board.aiTargets} />
        ) : null}

        {isEmpty ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            この日の計画・やることはまだありません。右下の＋から追加できます。
          </div>
        ) : null}
      </div>

      <Link
        href="/dashboard/board/add"
        aria-label="やることを追加"
        className={cn(
          'fixed bottom-[calc(88px+env(safe-area-inset-bottom,0px))] right-4 z-[70] md:bottom-[calc(24px+env(safe-area-inset-bottom,0px))]',
          'flex h-14 w-14 items-center justify-center rounded-full',
          'bg-primary text-primary-foreground shadow-lg',
          'active:scale-95 transition-transform',
        )}
      >
        <Plus className="h-7 w-7" />
      </Link>
    </div>
  );
}
