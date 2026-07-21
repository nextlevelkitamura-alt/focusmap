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
import { deriveBoardStatus } from '@/lib/board-status';
import { getSubagentsBySession, type SessionSubagent } from '@/lib/turso/session-subagents';
import { BoardPoller } from './_components/board-poller';
import { UndoBar } from './_components/undo-bar';
import { BoardPaneSwitch } from '@/components/today/board-pane-switch';
import { ThemeCardV2 } from '@/components/today/board-v2/theme-card';
import { DayHeader } from '@/components/today/board-v2/day-header';
import { AskLane } from '@/components/today/board-v2/ask-lane';
import { StrayBox } from '@/components/today/board-v2/stray-box';
import type {
  AskItem,
  BoardV2Data,
  FinishedTodoItem,
  SessionItem,
  StrayData,
  TaskItem,
  ThemeCardData,
} from '@/components/today/board-v2/types';

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

// 「終わったこと」ログの表示時de-dup（連続する同一entryを ×N バッジにまとめる）。
function dedupeLogs(logs: FinishedLog[]): { log: FinishedLog; count: number }[] {
  const out: { log: FinishedLog; count: number }[] = [];
  for (const log of logs) {
    const last = out[out.length - 1];
    if (last && last.log.entry === log.entry && last.log.repo === log.repo) {
      last.count += 1;
    } else {
      out.push({ log, count: 1 });
    }
  }
  return out;
}

interface BuildInput {
  selectedDate: string;
  isToday: boolean;
  todos: Todo[];
  stepsByTodo: Map<string, TodoStep[]>;
  aggByTodo: Map<string, TodoStepAggregate>;
  timesByTodo: Map<string, TodoTimes>;
  activeThemes: Theme[];
  themeProgress: Map<string, ThemeProgress>;
  totals: DailyTotals;
  finishedLogs: FinishedLog[];
  currentSessions: CurrentSession[];
  stuckBySession: Map<string, StuckWait>;
  subagentsBySession: Map<string, SessionSubagent[]>;
  repoNameBySlug: Map<string, string>;
}

// 取得済みデータ（新クエリなし）から契約型 BoardV2Data を構築する純関数。
// テーマ軸へ一本化: セッション・完了ログ・完了AI todoを、それぞれ所属テーマ/タスク/未分類へ振り分ける。
function buildBoardV2Data(input: BuildInput): BoardV2Data {
  const {
    selectedDate,
    isToday,
    todos,
    stepsByTodo,
    aggByTodo,
    timesByTodo,
    activeThemes,
    themeProgress,
    totals,
    finishedLogs,
    currentSessions,
    stuckBySession,
    subagentsBySession,
    repoNameBySlug,
  } = input;

  const todosById = new Map(todos.map((todo) => [todo.id, todo]));
  const themeById = new Map(activeThemes.map((theme) => [theme.id, theme]));
  const themeByName = new Map(activeThemes.map((theme) => [theme.name, theme]));

  const aiTodos = todos.filter((todo) => todo.assignee === 'ai');
  const aiTargets = aiTodos.map((todo) => ({ id: todo.id, title: todo.title }));

  // やること（TaskItem）= self（完了打消しはtodo.statusで表現）＋ AI open。
  const taskTodos = todos.filter((todo) => todo.assignee === 'self' || todo.status !== 'done');
  const taskItemById = new Map<string, TaskItem>();
  const taskItems: TaskItem[] = taskTodos.map((todo) => {
    const item: TaskItem = {
      todo,
      steps: stepsByTodo.get(todo.id) ?? [],
      agg: aggByTodo.get(todo.id) ?? null,
      times: timesByTodo.get(todo.id) ?? null,
      sessions: [],
      repoName: repoNameBySlug.get(todo.repo) ?? todo.repo,
    };
    taskItemById.set(todo.id, item);
    return item;
  });

  const sessionItems: SessionItem[] = currentSessions.map((session) => ({
    session,
    stuck: stuckBySession.get(session.sessionKey) ?? null,
    subagents: subagentsBySession.get(session.sessionKey) ?? [],
  }));

  // セッション振り分け: todoId一致→TaskItem直下／themeId一致→テーマ直下／どちらも無し→未分類。
  const themeSessionsByTheme = new Map<string, SessionItem[]>();
  const straySessions: SessionItem[] = [];
  for (const item of sessionItems) {
    const s = item.session;
    const taskItem = s.todoId ? taskItemById.get(s.todoId) : undefined;
    if (taskItem) {
      taskItem.sessions.push(item);
      continue;
    }
    const themeId = s.themeId && themeById.has(s.themeId) ? s.themeId : null;
    if (themeId) {
      const list = themeSessionsByTheme.get(themeId) ?? [];
      list.push(item);
      themeSessionsByTheme.set(themeId, list);
      continue;
    }
    straySessions.push(item);
  }

  // 完了AI todo（テーマ折りたたみ内）。未分類テーマの完了AI todoは契約に置き場が無いため表示しない。
  const finishedTodoByTheme = new Map<string, FinishedTodoItem[]>();
  for (const todo of todos) {
    if (todo.assignee !== 'ai' || todo.status !== 'done') continue;
    if (!todo.themeId || !themeById.has(todo.themeId)) continue;
    const list = finishedTodoByTheme.get(todo.themeId) ?? [];
    list.push({
      todo,
      doneSteps: (stepsByTodo.get(todo.id) ?? []).filter((step) => step.status === 'done').length,
      runMin: timesByTodo.get(todo.id)?.runMin ?? null,
    });
    finishedTodoByTheme.set(todo.themeId, list);
  }

  // 完了ログ: parentがテーマ名一致→そのテーマ／不一致→未分類（parent別グループ）。
  const finishedLogsByTheme = new Map<string, { entry: string; count: number }[]>();
  const strayLogsByParent = new Map<string, { entry: string; count: number }[]>();
  for (const { log, count } of dedupeLogs(finishedLogs)) {
    const theme = log.parent ? themeByName.get(log.parent) : undefined;
    if (theme) {
      const list = finishedLogsByTheme.get(theme.id) ?? [];
      list.push({ entry: log.entry, count });
      finishedLogsByTheme.set(theme.id, list);
    } else {
      const parent = log.parent || '新見出し';
      const list = strayLogsByParent.get(parent) ?? [];
      list.push({ entry: log.entry, count });
      strayLogsByParent.set(parent, list);
    }
  }

  // テーマカード群（activeThemes順・空テーマも出す）。
  const themes: ThemeCardData[] = activeThemes.map((theme) => {
    const tasks = taskItems.filter((item) => item.todo.themeId === theme.id);
    const themeSessions = themeSessionsByTheme.get(theme.id) ?? [];
    const themeAllSessions = [...tasks.flatMap((t) => t.sessions), ...themeSessions];
    const liveCount = themeAllSessions.filter(
      (s) => s.session.state === 'run' || s.session.state === 'sub',
    ).length;
    const waitCount = themeAllSessions.filter((s) => s.session.state === 'wait').length;
    return {
      theme,
      progress: themeProgress.get(theme.id) ?? null,
      tasks,
      themeSessions,
      finishedTodos: finishedTodoByTheme.get(theme.id) ?? [],
      finishedLogs: finishedLogsByTheme.get(theme.id) ?? [],
      liveCount,
      waitCount,
    };
  });

  // 未分類（テーマ無所属のtask・session・ログ）。
  const stray: StrayData = {
    tasks: taskItems.filter((item) => !item.todo.themeId || !themeById.has(item.todo.themeId)),
    sessions: straySessions,
    finishedLogs: [...strayLogsByParent.entries()].map(([parent, items]) => ({ parent, items })),
  };

  // きみの番: (a) 質問中のAI todo, (b) 確認待ちセッション。
  const asks: AskItem[] = [];
  for (const todo of aiTodos) {
    const status = deriveBoardStatus(todo, aggByTodo.get(todo.id));
    if (status.tone === 'question') {
      asks.push({
        kind: 'question',
        todo,
        themeName: todo.themeId ? themeById.get(todo.themeId)?.name ?? null : null,
      });
    }
  }
  for (const item of sessionItems) {
    if (item.session.state !== 'wait') continue;
    const s = item.session;
    const linkedTodo = s.todoId ? todosById.get(s.todoId) : undefined;
    const themeName =
      (linkedTodo?.themeId ? themeById.get(linkedTodo.themeId)?.name : undefined) ??
      (s.themeId ? themeById.get(s.themeId)?.name : undefined) ??
      null;
    asks.push({ kind: 'wait', session: s, waitMin: item.stuck?.waitMin ?? 0, themeName });
  }

  const totalCount = todos.length;
  const doneCount = todos.filter((todo) => todo.status === 'done').length;
  const progressPct = totalCount === 0 ? null : Math.round((doneCount / totalCount) * 100);
  const liveTotal = sessionItems.filter(
    (s) => s.session.state === 'run' || s.session.state === 'sub',
  ).length;
  const waitTotal = sessionItems.filter((s) => s.session.state === 'wait').length;

  return {
    selectedDate,
    isToday,
    progressPct,
    liveTotal,
    waitTotal,
    runMin: totals.runMin,
    waitMinTotal: totals.waitMin,
    asks,
    themes,
    stray,
    aiTargets,
  };
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
  });

  const justCompletedId =
    params.justCompleted &&
    todos.some((todo) => todo.id === params.justCompleted && todo.assignee === 'ai' && todo.status === 'done')
      ? params.justCompleted
      : null;

  const strayHasContent =
    board.stray.tasks.length > 0 || board.stray.sessions.length > 0 || board.stray.finishedLogs.length > 0;
  const isEmpty = board.themes.length === 0 && !strayHasContent;

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

        {board.asks.length > 0 ? <AskLane asks={board.asks} selectedDate={selectedDate} /> : null}

        {board.themes.length > 0 ? (
          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
            {board.themes.map((theme) => (
              <ThemeCardV2
                key={theme.theme?.id ?? '__theme__'}
                data={theme}
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
            この日のテーマ・やることはまだありません。右下の＋から追加できます。
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
