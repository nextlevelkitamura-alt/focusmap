import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Activity,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  HelpCircle,
  ListTodo,
  PauseCircle,
  Plus,
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
import { deriveBoardStatus, boardStatusClassName } from '@/lib/board-status';
import { carryOverAction, completeHeadingAction, toggleTodoAction } from './actions';
import { BoardPoller } from './_components/board-poller';
import { QuestionAnswer } from './_components/question-answer';
import { UndoBar } from './_components/undo-bar';
import { FixReattach } from './_components/fix-reattach';
import { ThemeEditor } from './_components/theme-editor';
import { FileAgentCheck } from './_components/file-agent-check';
import { SubagentNest } from './_components/subagent-nest';
import { getSubagentsBySession, type SessionSubagent } from '@/lib/turso/session-subagents';
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

// テーマ帯左インデント（縦線ワークフロー・進捗バー・繰越しボタンをチェックボックス幅へ揃える）。
const INDENT = 'ml-[46px]';

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

// 縦線ワークフロー（子09・v5モック準拠）: 上から下へステップを縦線で繋ぎ、
// done緑✓／doing青▶／todo白抜き。右に所要（done=実測分・doing=経過分）をSQL導出値で表示。
function StepFlow({ steps }: { steps: TodoStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className={cn('relative mt-2 list-none', INDENT)}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const glyph = step.status === 'done' ? '✓' : step.status === 'doing' ? '▶' : '';
        const nodeClass =
          step.status === 'done'
            ? 'bg-emerald-700'
            : step.status === 'doing'
              ? 'bg-blue-600'
              : step.status === 'skipped'
                ? 'bg-slate-200 text-slate-400 dark:bg-slate-700'
                : 'border-2 border-slate-300 bg-white dark:border-slate-600 dark:bg-transparent';
        const timeLabel =
          step.elapsedMin === null
            ? null
            : step.status === 'done'
              ? `${step.elapsedMin}分`
              : step.status === 'doing'
                ? `${step.elapsedMin}分経過`
                : null;
        return (
          <li
            key={step.id}
            className="relative flex items-start gap-2 py-[3px] text-[11px] leading-[1.45] text-muted-foreground"
          >
            {!last ? (
              <span aria-hidden className="absolute bottom-[-4px] left-[6px] top-[19px] w-0.5 bg-slate-200 dark:bg-slate-700" />
            ) : null}
            <span
              className={cn(
                'relative z-[1] mt-[1.5px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4.5px] text-[8.5px] font-extrabold leading-none text-white',
                nodeClass,
              )}
            >
              {glyph}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 break-words',
                step.status === 'skipped' && 'line-through opacity-60',
                step.kind === 'fix' && 'text-amber-700 dark:text-amber-400',
              )}
            >
              {step.kind === 'fix' ? <span className="mr-1">🔧</span> : null}
              {step.title}
              {step.kind === 'fix' ? <span className="ml-1 text-[10px]">手直し</span> : null}
            </span>
            {timeLabel ? (
              <span
                className={cn(
                  'ml-1.5 shrink-0 text-[10px] tabular-nums',
                  step.status === 'doing' ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-slate-400',
                )}
              >
                {timeLabel}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// タスク見出し右の累計2値（子09・v5モック準拠）: 実行N分・確認待ちN分。すべてSQL導出。
function TaskTimes({ times, running }: { times: TodoTimes; running: boolean }) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
      <span
        className={cn(
          'whitespace-nowrap text-[10px] font-semibold tabular-nums',
          running ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500',
        )}
      >
        実行 {times.runMin}分
      </span>
      <span
        className={cn(
          'whitespace-nowrap text-[10px] font-semibold tabular-nums',
          times.waitMin > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400',
        )}
      >
        確認待ち {times.waitMin}分
      </span>
    </div>
  );
}

function ProgressBar({ pct, tone }: { pct: number; tone: 'run' | 'review' }) {
  return (
    <div className={cn('mt-2 h-1 overflow-hidden rounded-full bg-muted', INDENT)}>
      <div
        className={cn('h-full rounded-full', tone === 'review' ? 'bg-emerald-500' : 'bg-blue-500')}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

// 左のチェックボックス（v5モック準拠・全タスク同一様式）。
// self=完了トグル／AIレビュー待ち=見出し完了（人間タップ・全step done時のみ・5秒undoで戻せる）／
// AI実行中=未完了の静的枠（完了は全ステップ後）。子05の完了/undoロジックは server action 側で不変。
function TaskCheck({ todo, reviewReady, selectedDate }: { todo: Todo; reviewReady: boolean; selectedDate: string }) {
  const square = (filled: boolean, invite: boolean) => (
    <span
      className={cn(
        'grid h-6 w-6 place-items-center rounded-lg',
        filled
          ? 'bg-emerald-600 text-white'
          : cn('border-2 bg-white dark:bg-transparent', invite ? 'border-emerald-500' : 'border-slate-300 dark:border-slate-600'),
      )}
    >
      {filled ? <Check className="h-3.5 w-3.5" /> : null}
    </span>
  );
  const tapClass = '-ml-1.5 -mt-1.5 inline-grid h-11 w-11 shrink-0 place-items-center rounded-xl active:scale-95';

  if (todo.assignee === 'self') {
    const isDone = todo.status === 'done';
    return (
      <form action={toggleTodoAction} className="shrink-0">
        <input type="hidden" name="id" value={todo.id} />
        <input type="hidden" name="nextStatus" value={isDone ? 'open' : 'done'} />
        <input type="hidden" name="date" value={selectedDate} />
        <button type="submit" aria-label={isDone ? `${todo.title}を未完了に戻す` : `${todo.title}を完了にする`} className={tapClass}>
          {square(isDone, false)}
        </button>
      </form>
    );
  }

  if (!reviewReady) {
    return (
      <span className={cn(tapClass, 'opacity-60')} title="全ステップ完了後に完了にできます" aria-hidden>
        {square(false, false)}
      </span>
    );
  }

  return (
    <form action={completeHeadingAction} className="shrink-0">
      <input type="hidden" name="id" value={todo.id} />
      <input type="hidden" name="date" value={selectedDate} />
      <button type="submit" aria-label={`${todo.title}をレビューして完了にする`} className={tapClass}>
        {square(false, true)}
      </button>
    </form>
  );
}

// 未完了タスクの「明日へ引き継ぐ」1タップ（子09・繰越し）。do_date+1・carried_from初回記録。
function CarryButton({ todoId, title, selectedDate }: { todoId: string; title: string; selectedDate: string }) {
  return (
    <form action={carryOverAction} className={cn('mt-2', INDENT)}>
      <input type="hidden" name="id" value={todoId} />
      <input type="hidden" name="date" value={selectedDate} />
      <button
        type="submit"
        aria-label={`${title}を明日へ引き継ぐ`}
        className="min-h-8 rounded-lg border border-border bg-background px-2.5 text-[11.5px] font-semibold text-muted-foreground active:scale-[0.99]"
      >
        明日へ引き継ぐ
      </button>
    </form>
  );
}

// テーマ帯内のタスク1件。self=軽量行／AI=状態ラベル・%・累計時間・縦線ワークフロー・質問/レビュー導線。
function TaskCard({
  todo,
  steps,
  agg,
  times,
  aiTargets,
  repoName,
  selectedDate,
}: {
  todo: Todo;
  steps: TodoStep[];
  agg: TodoStepAggregate | undefined;
  times: TodoTimes | undefined;
  aiTargets: { id: string; title: string }[];
  repoName: string;
  selectedDate: string;
}) {
  if (todo.assignee === 'self') {
    const isDone = todo.status === 'done';
    return (
      <div className="pt-3">
        <div className="flex items-start gap-2">
          <TaskCheck todo={todo} reviewReady={false} selectedDate={selectedDate} />
          <div className="min-w-0 flex-1">
            <p className={cn('break-words text-sm font-semibold', isDone && 'text-muted-foreground line-through')}>{todo.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-normal">
                {repoName || 'repo未設定'}
              </Badge>
              {todo.carriedFrom ? <span className="text-[10.5px] text-muted-foreground">昨日から</span> : null}
            </div>
          </div>
        </div>
        {!isDone ? <CarryButton todoId={todo.id} title={todo.title} selectedDate={selectedDate} /> : null}
      </div>
    );
  }

  const status = deriveBoardStatus(todo, agg);
  const pct = agg?.pct ?? null;
  const fixSteps = steps.filter((step) => step.kind === 'fix');
  const fixTargets = aiTargets.filter((target) => target.id !== todo.id);

  return (
    <div className="pt-3">
      <div className="flex items-start gap-2">
        <TaskCheck todo={todo} reviewReady={status.tone === 'review'} selectedDate={selectedDate} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold">{todo.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={cn('gap-1 font-semibold', boardStatusClassName(status.tone))}>
              {status.label}
            </Badge>
            {pct !== null ? (
              <span className={cn('text-[11.5px] font-bold tabular-nums', pct >= 100 ? 'text-emerald-600' : 'text-blue-600')}>{pct}%</span>
            ) : null}
            {todo.carriedFrom ? <span className="text-[10.5px] text-muted-foreground">昨日から</span> : null}
          </div>
        </div>
        {times ? <TaskTimes times={times} running={status.tone === 'run'} /> : null}
      </div>

      {pct !== null ? <ProgressBar pct={pct} tone={pct >= 100 ? 'review' : 'run'} /> : null}

      {todo.answer && !todo.answerConsumedAt ? (
        <p className={cn('mt-1 text-xs text-muted-foreground', INDENT)}>回答済（未消費）: {todo.answer}</p>
      ) : null}

      {steps.length > 0 ? (
        <StepFlow steps={steps} />
      ) : (
        <p className={cn('mt-1 text-xs text-muted-foreground', INDENT)}>ステップ未登録（計画待ち）</p>
      )}

      {status.tone === 'question' && todo.question ? (
        <div className={cn('mt-2', INDENT)}>
          {todo.questionGate ? (
            <p className="text-xs text-muted-foreground">
              これは承認が要る操作です。ボードからは回答できません。セッションで明示承認してください。
            </p>
          ) : (
            <>
              <p className="mb-1.5 flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300">
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0">AIの質問: {todo.question}</span>
              </p>
              <QuestionAnswer todoId={todo.id} choices={todo.questionChoices} allowFree={todo.questionAllowFree} date={selectedDate} />
            </>
          )}
        </div>
      ) : null}

      {status.tone === 'review' ? (
        <p className={cn('mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400', INDENT)}>
          全ステップ完了 — 左のチェックでレビュー完了にできます
        </p>
      ) : null}

      {fixSteps.length > 0 && fixTargets.length > 0 ? (
        <div className={cn('mt-2 flex flex-wrap gap-2', INDENT)}>
          {fixSteps.map((step) => (
            <FixReattach key={step.id} stepId={step.id} date={selectedDate} targets={fixTargets} />
          ))}
        </div>
      ) : null}

      <CarryButton todoId={todo.id} title={todo.title} selectedDate={selectedDate} />
    </div>
  );
}

// テーマ帯（案A・v5モック準拠）: 名前＋右に完了%＋鉛筆／目的・完了条件の小見出し＋本文／
// 未記入バッジ（人間の空作成）／配下計画チップ（子07計画タブへのリンクのみ・進捗の重複描画なし）。
function ThemeBand({
  theme,
  progress,
  todos,
  stepsByTodo,
  aggByTodo,
  timesByTodo,
  aiTargets,
  repoNameBySlug,
  selectedDate,
}: {
  theme: Theme | null;
  progress: ThemeProgress | undefined;
  todos: Todo[];
  stepsByTodo: Map<string, TodoStep[]>;
  aggByTodo: Map<string, TodoStepAggregate>;
  timesByTodo: Map<string, TodoTimes>;
  aiTargets: { id: string; title: string }[];
  repoNameBySlug: Map<string, string>;
  selectedDate: string;
}) {
  const isUncat = theme === null;
  const unfilled = !isUncat && !theme.purpose && !theme.doneCriteria;

  return (
    <article className="overflow-hidden rounded-2xl border border-border">
      <div className={cn('px-3 py-3', isUncat ? 'bg-muted/40' : 'bg-blue-50/60 dark:bg-blue-500/10')}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-[14.5px] font-bold leading-snug">{isUncat ? '未分類' : theme.name}</h3>
          <div className="flex shrink-0 items-center">
            {!isUncat && progress && progress.pct !== null ? (
              <span
                className="text-xs font-extrabold tabular-nums text-blue-700 dark:text-blue-300"
                aria-label={`完了${progress.pct}パーセント`}
              >
                {progress.pct}%
              </span>
            ) : null}
            {!isUncat ? (
              <ThemeEditor
                theme={{ id: theme.id, name: theme.name, purpose: theme.purpose, doneCriteria: theme.doneCriteria, goalRef: theme.goalRef }}
                date={selectedDate}
              />
            ) : null}
          </div>
        </div>

        {!isUncat ? (
          unfilled ? (
            <span className="mt-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              目的・完了条件 未記入
            </span>
          ) : (
            <div className="mt-1.5 space-y-1">
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground">目的</p>
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{theme.purpose || '—'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground">完了条件</p>
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{theme.doneCriteria || '—'}</p>
              </div>
            </div>
          )
        ) : null}

        {!isUncat && theme.planRefs.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {theme.planRefs.map((slug) => (
              <Link
                key={slug}
                href={`/dashboard/plans#${encodeURIComponent(slug)}`}
                className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-background px-2 py-0.5 text-[10.5px] text-muted-foreground active:scale-95"
              >
                {slug}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="divide-y divide-border/60 px-3 pb-3">
        {todos.map((todo) => (
          <TaskCard
            key={todo.id}
            todo={todo}
            steps={stepsByTodo.get(todo.id) ?? []}
            agg={aggByTodo.get(todo.id)}
            times={timesByTodo.get(todo.id)}
            aiTargets={aiTargets}
            repoName={repoNameBySlug.get(todo.repo) ?? todo.repo}
            selectedDate={selectedDate}
          />
        ))}
      </div>
    </article>
  );
}

function getAgentStatePresentation(state: string) {
  if (state === 'run') return { label: '稼働中', dot: 'bg-emerald-500' };
  if (state === 'sub') return { label: 'サブ稼働中', dot: 'bg-blue-500' };
  if (state === 'wait') return { label: '待機中', dot: 'bg-amber-500' };
  return { label: state || '状態不明', dot: 'bg-muted-foreground' };
}

// 動いているエージェント行（子09）: 宣言済み todo_id/theme_id を既取得のtodos/themesでMap join（追加クエリなし）し
// 「テーマ›タスク」パンくずを表示。左の人間チェックは宣言済み todo_id を読むだけで「終わったこと」へ格納する。
function AgentRow({
  session,
  stuck,
  themeById,
  todosById,
  selectedDate,
  subagents,
}: {
  session: CurrentSession;
  stuck?: StuckWait;
  themeById: Map<string, Theme>;
  todosById: Map<string, Todo>;
  selectedDate: string;
  subagents?: SessionSubagent[];
}) {
  const state = getAgentStatePresentation(session.state);
  const linkedTodo = session.todoId ? todosById.get(session.todoId) : undefined;
  const themeName =
    (linkedTodo?.themeId ? themeById.get(linkedTodo.themeId)?.name : undefined) ??
    (session.themeId ? themeById.get(session.themeId)?.name : undefined) ??
    '';
  const taskTitle = linkedTodo?.title ?? '';
  const breadcrumb = taskTitle
    ? themeName
      ? `${themeName} › ${taskTitle}`
      : taskTitle
    : themeName || '未紐付け→新見出しへ';
  const name = session.now || session.goal || 'エージェント';

  return (
    <div className="flex items-start gap-2 px-3 py-3">
      <FileAgentCheck sessionKey={session.sessionKey} todoTitle={taskTitle} date={selectedDate} label={name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', state.dot)} title={state.label} />
          <span className="min-w-0 truncate text-[13px] font-semibold">{name}</span>
        </div>
        <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">{breadcrumb}</p>
        <span
          className={cn(
            'mt-0.5 block text-[10.5px] font-semibold',
            session.state === 'wait' ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400',
          )}
        >
          {session.state === 'wait' && stuck ? `待機 ${stuck.waitMin}分` : state.label}
        </span>
        {subagents && subagents.length > 0 ? <SubagentNest subagents={subagents} /> : null}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Activity }) {
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

// 汎用: todos をアクティブテーマ順＋末尾「未分類」でグルーピング（今日のやること・終わったこと共通）。
function groupTodosByTheme(items: Todo[], activeThemes: Theme[], themeById: Map<string, Theme>) {
  const byTheme = new Map<string, Todo[]>();
  const uncategorized: Todo[] = [];
  for (const item of items) {
    if (item.themeId && themeById.has(item.themeId)) {
      const list = byTheme.get(item.themeId) ?? [];
      list.push(item);
      byTheme.set(item.themeId, list);
    } else {
      uncategorized.push(item);
    }
  }
  const groups: { theme: Theme | null; todos: Todo[] }[] = [];
  for (const theme of activeThemes) {
    const list = byTheme.get(theme.id);
    if (list && list.length > 0) groups.push({ theme, todos: list });
  }
  if (uncategorized.length > 0) groups.push({ theme: null, todos: uncategorized });
  return groups;
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
  const activeThemes = themesResult.data;
  const themeById = new Map(activeThemes.map((theme) => [theme.id, theme]));
  const themeProgress = themeProgressResult.data;
  const timesByTodo = timesResult.data;

  // ステップを todo_id ごとにまとめる。
  const stepsByTodo = new Map<string, TodoStep[]>();
  for (const step of stepsResult.data) {
    const list = stepsByTodo.get(step.todoId) ?? [];
    list.push(step);
    stepsByTodo.set(step.todoId, list);
  }
  const aggByTodo = aggResult.data;

  const todos = todosResult.data;
  const todosById = new Map(todos.map((todo) => [todo.id, todo]));
  const aiTodos = todos.filter((todo) => todo.assignee === 'ai');
  const aiTargets = aiTodos.map((todo) => ({ id: todo.id, title: todo.title }));
  const aiDone = aiTodos.filter((todo) => todo.status === 'done');

  // 今日のやること = self（全件・完了はバンド内で打消し線）＋ AI open。テーマ帯でグルーピングする。
  const todayItems = todos.filter((todo) => todo.assignee === 'self' || todo.status !== 'done');
  const todayGroups = groupTodosByTheme(todayItems, activeThemes, themeById);
  const finishedGroups = groupTodosByTheme(aiDone, activeThemes, themeById);

  const dedupedLogs = dedupeLogs(logsResult.data);
  // session_logs を親（見出し）ごとにまとめる（filed agent=タスク名／finish=目標名・新見出し）。
  const logsByParent = new Map<string, { entry: string; count: number }[]>();
  for (const { log, count } of dedupedLogs) {
    const parent = log.parent || '新見出し';
    const list = logsByParent.get(parent) ?? [];
    list.push({ entry: log.entry, count });
    logsByParent.set(parent, list);
  }

  const justCompletedId = params.justCompleted && aiDone.some((todo) => todo.id === params.justCompleted) ? params.justCompleted : null;
  const hasFinished = aiDone.length > 0 || logsByParent.size > 0;

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

      <section className="space-y-2.5" aria-labelledby="todos-heading">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-primary" />
          <h2 id="todos-heading" className="text-lg font-semibold">
            今日のやること
          </h2>
          <span className="text-sm text-muted-foreground">{todayItems.length}件</span>
        </div>
        {todayGroups.length > 0 ? (
          <div className="space-y-2.5">
            {todayGroups.map((group) => (
              <ThemeBand
                key={group.theme?.id ?? '__uncat__'}
                theme={group.theme}
                progress={group.theme ? themeProgress.get(group.theme.id) : undefined}
                todos={group.todos}
                stepsByTodo={stepsByTodo}
                aggByTodo={aggByTodo}
                timesByTodo={timesByTodo}
                aiTargets={aiTargets}
                repoNameBySlug={repoNameBySlug}
                selectedDate={selectedDate}
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
        <section className="space-y-2.5" aria-labelledby="agents-heading">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <h2 id="agents-heading" className="text-lg font-semibold">
              動いているエージェント
            </h2>
            <span className="text-sm text-muted-foreground">{currentResult.data.length}体</span>
          </div>
          {currentResult.data.length > 0 ? (
            <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border">
              {currentResult.data.map((session) => (
                <AgentRow
                  key={session.sessionKey}
                  session={session}
                  stuck={stuckBySession.get(session.sessionKey)}
                  themeById={themeById}
                  todosById={todosById}
                  selectedDate={selectedDate}
                  subagents={subagentsResult.data.get(session.sessionKey)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              稼働中のエージェントはいません。
            </div>
          )}
        </section>
      ) : null}

      {hasFinished ? (
        <section className="space-y-2.5" aria-labelledby="finished-heading">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-emerald-600" />
            <h2 id="finished-heading" className="text-lg font-semibold">
              終わったこと
            </h2>
          </div>
          {justCompletedId ? <UndoBar todoId={justCompletedId} date={selectedDate} /> : null}

          {finishedGroups.map((group) => (
            <div key={group.theme?.id ?? '__uncat__'} className="rounded-2xl border border-border p-3">
              <div
                className={cn(
                  'flex items-center gap-1.5 text-[11.5px] font-extrabold',
                  group.theme ? 'text-blue-700 dark:text-blue-300' : 'text-muted-foreground',
                )}
              >
                <Folder className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate">{group.theme ? group.theme.name : '未分類'}</span>
              </div>
              {group.todos.map((todo) => {
                const doneSteps = (stepsByTodo.get(todo.id) ?? []).filter((step) => step.status === 'done').length;
                const runMin = timesByTodo.get(todo.id)?.runMin;
                return (
                  <div key={todo.id} className="mt-2 flex items-baseline gap-2 text-[11.5px] text-slate-600 dark:text-slate-300">
                    <span className="shrink-0 font-bold text-emerald-600">✓</span>
                    <span className="min-w-0 flex-1 break-words">
                      {todo.title}
                      {doneSteps > 0 ? <span className="ml-1 text-muted-foreground">（✓ {doneSteps}ステップ完了）</span> : null}
                    </span>
                    {runMin ? <span className="shrink-0 text-[10px] tabular-nums text-slate-400">実行{runMin}分</span> : null}
                  </div>
                );
              })}
            </div>
          ))}

          {[...logsByParent.entries()].map(([parent, items]) => (
            <div key={parent} className="rounded-2xl border border-border p-3">
              <div className="flex items-center gap-1.5 text-[11.5px] font-extrabold text-muted-foreground">
                <Folder className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate">{parent}</span>
              </div>
              {items.map((item, index) => (
                <div key={`${parent}-${index}`} className="mt-2 flex items-baseline gap-2 text-[11.5px] text-slate-600 dark:text-slate-300">
                  <span className="shrink-0 font-bold text-emerald-600">✓</span>
                  <span className="min-w-0 flex-1 break-words">{item.entry}</span>
                  {item.count > 1 ? <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px]">×{item.count}</span> : null}
                </div>
              ))}
            </div>
          ))}
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
