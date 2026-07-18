import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Activity,
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  PauseCircle,
  PlayCircle,
  Plus,
  Radar,
  Settings2,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { getRepos, getTodosForDate, type Repo, type Todo, type TodoAiStatus } from '@/lib/turso/todos';
import { approveTodoAction, toggleTodoAction } from './actions';
import { BoardPoller } from './_components/board-poller';
import { BoardPaneSwitch } from '@/components/today/board-pane-switch';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ date?: string; added?: string; addError?: string }>;
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

function formatMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  return hours > 0 ? `${hours}h${String(rest).padStart(2, '0')}m` : `${rest}m`;
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

function getAiStatusPresentation(status: TodoAiStatus) {
  switch (status) {
    case '検知':
      return { label: '検知', icon: Radar, className: 'border-transparent bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' };
    case '立案中':
      return { label: '立案中', icon: Settings2, className: 'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' };
    case '実行中':
      return { label: '実行中', icon: PlayCircle, className: 'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' };
    case '確認待ち':
      return { label: '確認待ち', icon: Clock3, className: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' };
    case '完了':
      return { label: '完了', icon: CheckCircle2, className: 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' };
    default:
      return { label: '未検知', icon: Circle, className: 'border-transparent bg-muted text-muted-foreground' };
  }
}

function TodoRow({ todo, repoName, selectedDate }: { todo: Todo; repoName: string; selectedDate: string }) {
  const isDone = todo.status === 'done';
  const isAi = todo.assignee === 'ai';
  const presentation = isAi ? getAiStatusPresentation(todo.aiStatus) : null;
  const canApprove = isAi && todo.aiStatus === '確認待ち' && !isDone;

  return (
    <div className={cn('flex min-h-11 items-center gap-3 rounded-md border border-border/50 px-3 py-2', isDone && 'opacity-60')}>
      {isAi ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center" title={isDone ? '完了' : '未完了'}>
          {isDone ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-muted-foreground/40" />}
        </span>
      ) : (
        <form action={toggleTodoAction}>
          <input type="hidden" name="id" value={todo.id} />
          <input type="hidden" name="nextStatus" value={isDone ? 'open' : 'done'} />
          <input type="hidden" name="date" value={selectedDate} />
          <button
            type="submit"
            aria-label={isDone ? '未完了に戻す' : '完了にする'}
            className="flex h-6 w-6 shrink-0 items-center justify-center"
          >
            {isDone ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
          </button>
        </form>
      )}

      <span className={cn('min-w-0 flex-1 break-words text-sm', isDone && 'text-muted-foreground line-through')}>
        {todo.title}
      </span>

      {presentation ? (
        <Badge variant="outline" className={cn('shrink-0 gap-1', presentation.className)}>
          <presentation.icon className="h-3 w-3" />
          {presentation.label}
        </Badge>
      ) : (
        <Badge variant="secondary" className="shrink-0 font-normal">
          {repoName || 'repo未設定'}
        </Badge>
      )}

      {canApprove ? (
        <form action={approveTodoAction}>
          <input type="hidden" name="id" value={todo.id} />
          <input type="hidden" name="date" value={selectedDate} />
          <Button type="submit" size="sm" variant="outline" className="h-8 shrink-0 px-2.5 text-xs">
            承認
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function getAgentStatePresentation(state: string) {
  if (state === 'run') return { label: '稼働中', dot: 'bg-emerald-500' };
  if (state === 'sub') return { label: 'サブ稼働中', dot: 'bg-blue-500' };
  if (state === 'wait') return { label: '待機中', dot: 'bg-amber-500' };
  return { label: state || '状態不明', dot: 'bg-muted-foreground' };
}

function AgentRow({ session, stuck }: { session: CurrentSession; stuck?: StuckWait }) {
  const state = getAgentStatePresentation(session.state);
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', state.dot)} title={state.label} />
        <span className="min-w-0 truncate text-sm font-medium">{session.now || session.goal || 'エージェント'}</span>
      </div>
      <span className={cn('shrink-0 text-xs tabular-nums', session.state === 'wait' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
        {session.state === 'wait' && stuck ? `待機${stuck.waitMin}分` : state.label}
      </span>
    </div>
  );
}

function SummaryTile({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock3 }) {
  return (
    <Card>
      <CardContent className="space-y-1.5 p-3 text-center sm:p-4">
        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          <span>{label}</span>
        </div>
        <div className="text-xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
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

  const [reposResult, todosResult, totalsResult, logsResult, currentResult, stuckResult] = await Promise.all([
    load('inbox', [] as Repo[], () => getRepos()),
    load('inbox', [] as Todo[], () => getTodosForDate(selectedDate)),
    load('board', EMPTY_TOTALS, () => getDailyTotals(selectedDate)),
    load('board', [] as FinishedLog[], () => getFinishedLogs(selectedDate)),
    isToday
      ? load('board', [] as CurrentSession[], () => getCurrentSessions())
      : Promise.resolve({ data: [] as CurrentSession[], error: null } as LoadResult<CurrentSession[]>),
    isToday
      ? load('board', [] as StuckWait[], () => getStuckWait(0))
      : Promise.resolve({ data: [] as StuckWait[], error: null } as LoadResult<StuckWait[]>),
  ]);

  const errors = new Set(
    [reposResult.error, todosResult.error, totalsResult.error, logsResult.error, currentResult.error, stuckResult.error].filter(
      (error): error is DataSource => error !== null,
    ),
  );

  const repoNameBySlug = new Map(reposResult.data.map((repo) => [repo.slug, repo.name]));
  const stuckBySession = new Map(stuckResult.data.map((stuck) => [stuck.sessionKey, stuck]));

  return (
    <div className="relative min-h-0 flex-1 space-y-6 overflow-y-auto pb-20">
      {isToday ? <BoardPoller /> : null}

      <BoardPaneSwitch active="board" />

      <header className="flex items-center justify-between gap-2">
        <Button variant="outline" size="icon" className="h-11 w-11" asChild>
          <Link href={buildDateHref(shiftDate(selectedDate, -1))} aria-label="前の日へ">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1 text-center text-base font-semibold">{formatDateLabel(selectedDate, isToday)}</div>
        <Button variant="outline" size="icon" className="h-11 w-11" asChild>
          <Link href={buildDateHref(shiftDate(selectedDate, 1))} aria-label="次の日へ">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </header>

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

      <section className="space-y-3" aria-labelledby="todos-heading">
        <div className="flex items-center gap-2">
          <Check className="h-5 w-5 text-primary" />
          <h2 id="todos-heading" className="text-lg font-semibold">
            今日のやること {todosResult.data.length}件
          </h2>
        </div>
        {todosResult.data.length > 0 ? (
          <div className="space-y-2">
            {todosResult.data.map((todo) => (
              <TodoRow key={todo.id} todo={todo} repoName={repoNameBySlug.get(todo.repo) ?? todo.repo} selectedDate={selectedDate} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            この日のやることはまだありません。右下の＋から追加できます。
          </div>
        )}
      </section>

      {isToday ? (
        <section className="space-y-3" aria-labelledby="agents-heading">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <h2 id="agents-heading" className="text-lg font-semibold">
              動いているエージェント {currentResult.data.length}体
            </h2>
          </div>
          {currentResult.data.length > 0 ? (
            <div className="space-y-2">
              {currentResult.data.map((session) => (
                <AgentRow key={session.sessionKey} session={session} stuck={stuckBySession.get(session.sessionKey)} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              稼働中のエージェントはいません。
            </div>
          )}
        </section>
      ) : null}

      {logsResult.data.length > 0 ? (
        <section className="space-y-3" aria-labelledby="finished-heading">
          <h2 id="finished-heading" className="text-lg font-semibold">
            終わったこと
          </h2>
          <Card>
            <CardContent className="space-y-1 p-3 sm:p-4">
              {logsResult.data.map((log, index) => (
                <div key={`${log.createdAt}-${index}`} className="flex items-start gap-2 py-1 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="min-w-0 break-words">{log.entry}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="text-lg font-semibold">
          本日サマリ
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile label="実行" value={formatMinutes(totalsResult.data.runMin)} icon={Activity} />
          <SummaryTile label="待ち" value={formatMinutes(totalsResult.data.waitMin)} icon={PauseCircle} />
          <SummaryTile label="稼働" value={isToday ? `${currentResult.data.length}体` : '−'} icon={Users} />
        </div>
      </section>

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
