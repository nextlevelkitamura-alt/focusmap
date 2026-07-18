import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Activity,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  HelpCircle,
  PauseCircle,
  Plus,
  Settings2,
  Users,
  Wrench,
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
import { getRepos, getTodosForDate, type Repo, type Todo } from '@/lib/turso/todos';
import { getStepAggregatesForDate, getStepsForDate, type TodoStep, type TodoStepAggregate } from '@/lib/turso/todo-steps';
import { deriveBoardStatus, boardStatusClassName, type BoardStatus } from '@/lib/board-status';
import { approveTodoAction, toggleTodoAction } from './actions';
import { BoardPoller } from './_components/board-poller';
import { QuestionAnswer } from './_components/question-answer';
import { CompleteControl } from './_components/complete-control';
import { UndoBar } from './_components/undo-bar';
import { FixReattach } from './_components/fix-reattach';
import { BoardPaneSwitch } from '@/components/today/board-pane-switch';

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

function StepList({ steps }: { steps: TodoStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {steps.map((step) => {
        const kindIcon = step.kind === 'fix' ? '🔧' : step.kind === 'review' ? '★' : null;
        return (
          <li key={step.id} className="flex items-baseline gap-1.5 text-xs">
            <span className="w-4 shrink-0 text-center">
              {step.status === 'done' ? (
                <span className="font-bold text-emerald-600">✔</span>
              ) : step.status === 'doing' ? (
                <span className="font-bold text-blue-600">▶</span>
              ) : step.status === 'skipped' ? (
                <span className="text-muted-foreground/50">–</span>
              ) : (
                <span className="text-muted-foreground/40">○</span>
              )}
            </span>
            <span
              className={cn(
                'min-w-0 break-words text-muted-foreground',
                step.status === 'skipped' && 'line-through opacity-60',
                step.kind === 'fix' && 'text-amber-700 dark:text-amber-400',
              )}
            >
              {kindIcon ? <span className="mr-1">{kindIcon}</span> : null}
              {step.title}
              {step.kind === 'fix' ? <span className="ml-1 text-[11px] text-amber-600">手直し</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ProgressBar({ pct, tone }: { pct: number; tone: 'run' | 'review' }) {
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full', tone === 'review' ? 'bg-emerald-500' : 'bg-blue-500')}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

function StatusPct({ status, agg }: { status: BoardStatus; agg: TodoStepAggregate | undefined }) {
  const pct = agg?.pct ?? null;
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      <Badge variant="outline" className={cn('gap-1 font-semibold', boardStatusClassName(status.tone))}>
        {status.label}
      </Badge>
      {pct === null ? (
        <span className="text-xs font-normal text-muted-foreground">—</span>
      ) : (
        <span className={cn('text-xs font-bold tabular-nums', pct >= 100 ? 'text-emerald-600' : 'text-blue-600')}>
          {pct}%
        </span>
      )}
    </div>
  );
}

// 開いているAI todo（計画待ち/実行中）の行。ステップ入れ子・%バー・状態ラベルを持つ。
function AiTodoCard({
  todo,
  steps,
  agg,
  status,
  selectedDate,
  fixTargets,
}: {
  todo: Todo;
  steps: TodoStep[];
  agg: TodoStepAggregate | undefined;
  status: BoardStatus;
  selectedDate: string;
  fixTargets: { id: string; title: string }[];
}) {
  const pct = agg?.pct ?? null;
  return (
    <div className="rounded-md border border-border/50 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 break-words text-sm font-medium">{todo.title}</span>
        <StatusPct status={status} agg={agg} />
      </div>
      {pct !== null ? <ProgressBar pct={pct} tone={pct >= 100 ? 'review' : 'run'} /> : null}
      {steps.length > 0 ? (
        <StepList steps={steps} />
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">ステップ未登録（計画待ち）</p>
      )}
      {steps.some((step) => step.kind === 'fix') && fixTargets.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {steps
            .filter((step) => step.kind === 'fix')
            .map((step) => (
              <FixReattach key={step.id} stepId={step.id} date={selectedDate} targets={fixTargets} />
            ))}
        </div>
      ) : null}
    </div>
  );
}

function SelfTodoRow({ todo, repoName, selectedDate }: { todo: Todo; repoName: string; selectedDate: string }) {
  const isDone = todo.status === 'done';
  return (
    <div className={cn('flex min-h-11 items-center gap-3 rounded-md border border-border/50 px-3 py-2', isDone && 'opacity-60')}>
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
      <span className={cn('min-w-0 flex-1 break-words text-sm', isDone && 'text-muted-foreground line-through')}>
        {todo.title}
      </span>
      <Badge variant="secondary" className="shrink-0 font-normal">
        {repoName || 'repo未設定'}
      </Badge>
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

// 「終わったこと」の完了済みタスク行（入れ子保持・経路アイコン）。
function DoneTodoRow({ todo, steps }: { todo: Todo; steps: TodoStep[] }) {
  const routine = todo.route === 'routine' || todo.completedBy === 'routine';
  const single = todo.route === 'single';
  const hasFix = steps.some((step) => step.kind === 'fix');
  return (
    <div className="rounded-md border border-border/40 px-3 py-2">
      <div className="flex items-baseline gap-2 text-sm text-muted-foreground">
        <span className="shrink-0" title={routine ? '定型自動' : single ? '単発' : '人間承認済み'}>
          {routine ? <Settings2 className="h-4 w-4 text-emerald-600" /> : single ? <span className="text-muted-foreground">·</span> : <Check className="h-4 w-4 text-emerald-600" />}
        </span>
        <span className="min-w-0 flex-1 break-words">{todo.title}</span>
        {hasFix ? (
          <span className="flex shrink-0 items-center gap-0.5 text-xs text-amber-600">
            <Wrench className="h-3 w-3" />
            手直し中
          </span>
        ) : null}
      </div>
      {steps.length > 0 ? <StepList steps={steps} /> : null}
    </div>
  );
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

  const [reposResult, todosResult, stepsResult, aggResult, totalsResult, logsResult, currentResult, stuckResult] = await Promise.all([
    load('inbox', [] as Repo[], () => getRepos()),
    load('inbox', [] as Todo[], () => getTodosForDate(selectedDate)),
    load('inbox', [] as TodoStep[], () => getStepsForDate(selectedDate)),
    load('inbox', new Map<string, TodoStepAggregate>(), () => getStepAggregatesForDate(selectedDate)),
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
    [reposResult.error, todosResult.error, stepsResult.error, aggResult.error, totalsResult.error, logsResult.error, currentResult.error, stuckResult.error].filter(
      (error): error is DataSource => error !== null,
    ),
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
  const aggByTodo = aggResult.data;

  const todos = todosResult.data;
  const selfTodos = todos.filter((todo) => todo.assignee === 'self');
  const aiTodos = todos.filter((todo) => todo.assignee === 'ai');
  const aiOpen = aiTodos.filter((todo) => todo.status !== 'done');
  const aiDone = aiTodos.filter((todo) => todo.status === 'done');

  // 状態ラベルを導出して振り分け。確認待ち（質問・レビュー）は最上部へ。
  const withStatus = aiOpen.map((todo) => ({ todo, status: deriveBoardStatus(todo, aggByTodo.get(todo.id)) }));
  const attention = withStatus.filter((item) => item.status.tone === 'question' || item.status.tone === 'review');
  const working = withStatus.filter((item) => item.status.tone === 'plan' || item.status.tone === 'run');

  // 手直し付け替えの候補（他の開いているAI todo）。
  const fixTargetsFor = (currentId: string) =>
    aiOpen.filter((todo) => todo.id !== currentId).map((todo) => ({ id: todo.id, title: todo.title }));

  const dedupedLogs = dedupeLogs(logsResult.data);
  const justCompletedId = params.justCompleted && aiDone.some((todo) => todo.id === params.justCompleted) ? params.justCompleted : null;

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

      {attention.length > 0 ? (
        <section className="space-y-2" aria-labelledby="attention-heading">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-600" />
            <h2 id="attention-heading" className="text-lg font-semibold">
              確認待ち
            </h2>
            <span className="rounded-full bg-amber-500 px-2 text-xs font-bold text-white">{attention.length}</span>
          </div>
          <div className="space-y-2">
            {attention.map(({ todo, status }) => {
              const steps = stepsByTodo.get(todo.id) ?? [];
              const agg = aggByTodo.get(todo.id);
              return (
                <div key={todo.id} className="rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 dark:bg-amber-500/10">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-amber-600">
                      {status.tone === 'question' ? <HelpCircle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-sm font-medium">{todo.title}</span>
                    <StatusPct status={status} agg={agg} />
                  </div>

                  {status.tone === 'review' ? (
                    <>
                      <ProgressBar pct={100} tone="review" />
                      <StepList steps={steps} />
                      <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">全ステップ完了 — あなたのレビュー待ち</p>
                      <div className="mt-2">
                        <CompleteControl todoId={todo.id} date={selectedDate} />
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mt-1.5 text-sm text-amber-800 dark:text-amber-300">AIの質問: {todo.question}</p>
                      {todo.questionGate ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          これは承認が要る操作です。ボードからは回答できません。セッションで明示承認してください。
                        </p>
                      ) : (
                        <div className="mt-2">
                          <QuestionAnswer
                            todoId={todo.id}
                            choices={todo.questionChoices}
                            allowFree={todo.questionAllowFree}
                            date={selectedDate}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="todos-heading">
        <div className="flex items-center gap-2">
          <Check className="h-5 w-5 text-primary" />
          <h2 id="todos-heading" className="text-lg font-semibold">
            今日のやること {selfTodos.length + working.length}件
          </h2>
        </div>
        {selfTodos.length + working.length > 0 ? (
          <div className="space-y-2">
            {selfTodos.map((todo) => (
              <SelfTodoRow key={todo.id} todo={todo} repoName={repoNameBySlug.get(todo.repo) ?? todo.repo} selectedDate={selectedDate} />
            ))}
            {working.map(({ todo, status }) => (
              <AiTodoCard
                key={todo.id}
                todo={todo}
                steps={stepsByTodo.get(todo.id) ?? []}
                agg={aggByTodo.get(todo.id)}
                status={status}
                selectedDate={selectedDate}
                fixTargets={fixTargetsFor(todo.id)}
              />
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

      {aiDone.length > 0 || dedupedLogs.length > 0 ? (
        <section className="space-y-3" aria-labelledby="finished-heading">
          <h2 id="finished-heading" className="text-lg font-semibold">
            終わったこと
          </h2>
          {justCompletedId ? <UndoBar todoId={justCompletedId} date={selectedDate} /> : null}
          {aiDone.length > 0 ? (
            <div className="space-y-2">
              {aiDone.map((todo) => (
                <DoneTodoRow key={todo.id} todo={todo} steps={stepsByTodo.get(todo.id) ?? []} />
              ))}
            </div>
          ) : null}
          {dedupedLogs.length > 0 ? (
            <Card>
              <CardContent className="space-y-1 p-3 sm:p-4">
                {dedupedLogs.map(({ log, count }, index) => (
                  <div key={`${log.createdAt}-${index}`} className="flex items-start gap-2 py-1 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="min-w-0 break-words">{log.entry}</span>
                    {count > 1 ? <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs">×{count}</span> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
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
