import Link from 'next/link';
import {
  Activity,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PauseCircle,
  Plus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  getCurrentSessions,
  getDailyTotals,
  getDeclaredGoals,
  getFinishedLogs,
  getGoalRollup,
  getSessionBreakdown,
  getStuckWait,
  type CurrentSession,
  type DailyTotals,
  type FinishedLog,
  type SessionBreakdown,
  type StuckWait,
} from '@/lib/turso/personal-os-board';
import { cn } from '@/lib/utils';
import { SessionGoalSelect } from '@/components/workspace/session-goal-select';
import { addGoal } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    date?: string;
    goal?: string;
    added?: string;
    addError?: string;
  }>;
}

type DataSource = 'board' | 'inbox';

interface LoadResult<T> {
  data: T;
  error: DataSource | null;
}

interface GoalBlock {
  name: string;
  runMin: number;
  waitMin: number;
  subMin: number;
  declared: boolean;
  hasRollup: boolean;
  sessions: CurrentSession[];
  logs: FinishedLog[];
}

const EMPTY_TOTALS: DailyTotals = {
  sessionDate: '',
  runMin: 0,
  waitMin: 0,
  subMin: 0,
  sessions: 0,
};

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

function formatDateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('ja-JP', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  return `${year}年${month}月${day}日（${weekday}）`;
}

function formatMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  return hours > 0 ? `${hours}h${String(rest).padStart(2, '0')}m` : `${rest}m`;
}

function normalizeGoal(goal: string) {
  const normalized = goal.trim();
  return !normalized || normalized === '?' ? 'その他' : normalized;
}

async function load<T>(
  source: DataSource,
  fallback: T,
  getter: () => Promise<T>,
): Promise<LoadResult<T>> {
  try {
    return { data: await getter(), error: null };
  } catch {
    return { data: fallback, error: source };
  }
}

function buildDateHref(date: string, goal?: string) {
  const params = new URLSearchParams({ date });
  if (goal) params.set('goal', goal);
  return `/dashboard/workspace/sessions?${params.toString()}`;
}

function getStatePresentation(state: string) {
  if (state === 'run') return { label: 'メイン実行中', dot: 'bg-emerald-500' };
  if (state === 'sub') return { label: 'サブ実行中', dot: 'bg-blue-500' };
  if (state === 'wait') return { label: '待機中', dot: 'bg-amber-500' };
  return { label: state || '状態不明', dot: 'bg-muted-foreground' };
}

function MiniStackedBar({ runMin, subMin, waitMin }: Pick<GoalBlock, 'runMin' | 'subMin' | 'waitMin'>) {
  const total = runMin + subMin + waitMin;
  if (total <= 0) return null;

  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      aria-label={`メイン実行${runMin}分、サブ実行${subMin}分、待ち${waitMin}分`}
    >
      <div className="bg-emerald-500" style={{ width: `${(runMin / total) * 100}%` }} />
      <div className="bg-blue-500" style={{ width: `${(subMin / total) * 100}%` }} />
      <div className="bg-amber-500" style={{ width: `${(waitMin / total) * 100}%` }} />
    </div>
  );
}

function CurrentSessionRow({
  session,
  breakdown,
  stuck,
}: {
  session: CurrentSession;
  breakdown?: SessionBreakdown;
  stuck?: StuckWait;
}) {
  const state = getStatePresentation(session.state);
  const isLongWait = session.state === 'wait' && Boolean(stuck && stuck.waitMin >= 15);

  return (
    <div className="flex min-h-11 flex-col gap-2 rounded-md border border-border/50 px-3 py-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center">
        <span
          className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full sm:mt-0', state.dot)}
          title={state.label}
        >
          <span className="sr-only">{state.label}</span>
        </span>
        <span className="min-w-0 break-words text-sm font-medium">
          {session.now || '作業内容未設定'}
        </span>
        <Badge variant="secondary" className="shrink-0 font-normal">
          {session.subN > 0 ? `サブ${session.subN}体稼働` : 'メインのみ'}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[18px] text-xs text-muted-foreground sm:justify-end sm:pl-0">
        {isLongWait && stuck ? (
          <span className="font-medium text-destructive">待機 {stuck.waitMin}分経過</span>
        ) : session.state === 'wait' && stuck ? (
          <span className="text-amber-600 dark:text-amber-400">待機 {stuck.waitMin}分経過</span>
        ) : null}
        <span className="tabular-nums">
          実行{breakdown?.runMin ?? 0}m・待ち{breakdown?.waitMin ?? 0}m
        </span>
      </div>
    </div>
  );
}

function GoalCard({
  block,
  isToday,
  breakdownBySession,
  stuckBySession,
}: {
  block: GoalBlock;
  isToday: boolean;
  breakdownBySession: Map<string, SessionBreakdown>;
  stuckBySession: Map<string, StuckWait>;
}) {
  const declaredOnly =
    block.declared && !block.hasRollup && block.sessions.length === 0 && block.logs.length === 0;

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 text-card-foreground sm:p-4',
        declaredOnly ? 'border-dashed border-border' : 'border-border/60',
      )}
    >
      <div className="space-y-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <h3 className="min-w-0 break-words text-sm font-semibold sm:text-base">{block.name}</h3>
          <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
            メイン実行 {block.runMin}m・サブ {block.subMin}m・待ち {block.waitMin}m
          </p>
        </div>
        <MiniStackedBar runMin={block.runMin} subMin={block.subMin} waitMin={block.waitMin} />
      </div>

      {declaredOnly ? (
        <div className="mt-3 flex min-h-11 items-center rounded-md border border-dashed border-border/70 px-3 text-sm text-muted-foreground">
          未着手
        </div>
      ) : null}

      {isToday && block.sessions.length > 0 ? (
        <div className="mt-3 space-y-2">
          {block.sessions.map((session) => (
            <CurrentSessionRow
              key={session.sessionKey}
              session={session}
              breakdown={breakdownBySession.get(session.sessionKey)}
              stuck={stuckBySession.get(session.sessionKey)}
            />
          ))}
        </div>
      ) : null}

      {block.logs.length > 0 ? (
        <div className="mt-3 border-t border-border/40 pt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">終わったこと</p>
          <div className="space-y-1">
            {block.logs.map((log, index) => (
              <div
                key={`${log.createdAt}-${index}`}
                className="flex items-start gap-2 py-1 text-sm text-muted-foreground"
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="min-w-0 break-words">{log.entry}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  detail,
}: {
  label: string;
  value: string;
  icon: typeof Clock3;
  detail?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{label}</span>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {detail ? <p className="text-[11px] text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function SessionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const today = getJstDate();
  const selectedDate = isDate(params.date) ? params.date : today;
  const isToday = selectedDate === today;

  const [totalsResult, rollupResult, breakdownResult, logsResult, declaredResult, currentResult, stuckResult] =
    await Promise.all([
      load('board', EMPTY_TOTALS, () => getDailyTotals(selectedDate)),
      load('board', [], () => getGoalRollup(selectedDate)),
      load('board', [], () => getSessionBreakdown(selectedDate)),
      load('board', [], () => getFinishedLogs(selectedDate)),
      load('inbox', [], () => getDeclaredGoals(selectedDate)),
      isToday
        ? load('board', [], () => getCurrentSessions())
        : Promise.resolve({ data: [], error: null } as LoadResult<CurrentSession[]>),
      isToday
        ? load('board', [], () => getStuckWait(0))
        : Promise.resolve({ data: [], error: null } as LoadResult<StuckWait[]>),
    ]);

  const errors = new Set(
    [
      totalsResult.error,
      rollupResult.error,
      breakdownResult.error,
      logsResult.error,
      declaredResult.error,
      currentResult.error,
      stuckResult.error,
    ].filter((error): error is DataSource => error !== null),
  );

  const blocks = new Map<string, GoalBlock>();
  const getBlock = (rawGoal: string) => {
    const name = normalizeGoal(rawGoal);
    const existing = blocks.get(name);
    if (existing) return existing;
    const block: GoalBlock = {
      name,
      runMin: 0,
      waitMin: 0,
      subMin: 0,
      declared: false,
      hasRollup: false,
      sessions: [],
      logs: [],
    };
    blocks.set(name, block);
    return block;
  };

  for (const rollup of rollupResult.data) {
    const block = getBlock(rollup.goal);
    block.runMin += rollup.runMin;
    block.waitMin += rollup.waitMin;
    block.subMin += rollup.subMin;
    block.hasRollup = true;
  }
  for (const goal of declaredResult.data) getBlock(goal.name).declared = true;
  if (isToday) {
    for (const session of currentResult.data) getBlock(session.goal).sessions.push(session);
  }
  for (const log of logsResult.data) getBlock(log.parent).logs.push(log);

  const goalBlocks = Array.from(blocks.values());
  const selectedGoal = goalBlocks.some((block) => block.name === params.goal)
    ? params.goal
    : goalBlocks[0]?.name;
  const selectedGoalBlock = goalBlocks.find((block) => block.name === selectedGoal);
  const breakdownBySession = new Map(
    breakdownResult.data.map((breakdown) => [breakdown.sessionKey, breakdown]),
  );
  const stuckBySession = new Map(stuckResult.data.map((stuck) => [stuck.sessionKey, stuck]));
  const stuckAlerts = stuckResult.data.filter((stuck) => stuck.waitMin > 15);
  const runningMain = currentResult.data.filter((session) =>
    ['run', 'sub'].includes(session.state),
  ).length;
  const delegatedSubs = currentResult.data.reduce((sum, session) => sum + session.subN, 0);
  const activeSessions = runningMain + delegatedSubs;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {isToday ? '本日' : 'アーカイブ'}
          </p>
          <h1 className="text-xl font-semibold tracking-tight">デイリー</h1>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <Button variant="outline" size="icon" className="h-11 w-11" asChild>
            <Link
              href={buildDateHref(shiftDate(selectedDate, -1), selectedGoal)}
              aria-label="前の日へ"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1 text-center text-sm font-medium sm:min-w-48 sm:flex-none">
            {formatDateLabel(selectedDate)}
          </div>
          <Button variant="outline" size="icon" className="h-11 w-11" asChild>
            <Link
              href={buildDateHref(shiftDate(selectedDate, 1), selectedGoal)}
              aria-label="次の日へ"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </header>

      {errors.size > 0 ? (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">未接続のデータがあります</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            {errors.has('board') ? (
              <p>
                実行履歴には <code>PERSONAL_OS_BOARD_DATABASE_URL</code> と、リモートDBの場合は
                <code> PERSONAL_OS_BOARD_AUTH_TOKEN</code> が必要です。
              </p>
            ) : null}
            {errors.has('inbox') ? (
              <p>
                宣言目標には <code>PERSONAL_OS_INBOX_DATABASE_URL</code> と、リモートDBの場合は
                <code> PERSONAL_OS_INBOX_AUTH_TOKEN</code> が必要です。
              </p>
            ) : null}
            <p>接続できたデータだけで画面を表示しています。</p>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3" aria-label="今日の目標">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SessionGoalSelect
            goals={goalBlocks.map((block) => block.name)}
            selectedGoal={selectedGoal}
          />
          {isToday ? (
            <form action={addGoal} className="flex w-full gap-2 sm:w-auto">
              <Input
                key={params.added ?? 'new-goal'}
                name="name"
                required
                placeholder="目標を入力"
                aria-label="追加する目標"
                className="h-11 min-w-0 flex-1 sm:w-64"
              />
              <Button type="submit" variant="outline" className="h-11 shrink-0 px-3">
                <Plus className="mr-1.5 h-4 w-4" />
                目標を追加
              </Button>
            </form>
          ) : null}
        </div>

        {params.addError === '1' ? (
          <p role="alert" className="text-sm text-destructive">
            目標を追加できませんでした。Inbox DBの接続設定を確認してください。
          </p>
        ) : null}

        {!selectedGoalBlock ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {isToday ? '今日の目標はまだありません。' : 'この日の記録はありません。'}
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="text-lg font-semibold">
          本日サマリ
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard
            label="メイン実行"
            value={formatMinutes(totalsResult.data.runMin)}
            icon={Activity}
          />
          <SummaryCard
            label="サブ実行"
            value={formatMinutes(totalsResult.data.subMin)}
            icon={Users}
          />
          <SummaryCard
            label="待たされ"
            value={formatMinutes(totalsResult.data.waitMin)}
            icon={PauseCircle}
          />
          <SummaryCard
            label="稼働中"
            value={isToday ? `${activeSessions}体` : '−'}
            icon={Clock3}
            detail={isToday ? `メイン${runningMain}・サブ${delegatedSubs}` : 'メイン−・サブ−'}
          />
        </div>
      </section>

      {isToday ? (
        <section className="space-y-3" aria-labelledby="stuck-heading">
          <div className="flex items-center gap-2">
            <PauseCircle className="h-5 w-5 text-amber-500" />
            <h2 id="stuck-heading" className="text-lg font-semibold">
              ⏸放置アラート（15分超）
            </h2>
          </div>
          <Card>
            <CardContent className="p-3 sm:p-4">
              {stuckAlerts.length > 0 ? (
                <div className="divide-y divide-border/50">
                  {stuckAlerts.map((stuck) => (
                    <div
                      key={stuck.sessionKey}
                      className="flex min-h-11 flex-col justify-center gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">{normalizeGoal(stuck.goal)}</p>
                        <p className="break-all text-xs text-muted-foreground">{stuck.repo || 'repo未設定'}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-destructive">
                        {stuck.waitMin}分
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-3 text-center text-sm text-muted-foreground">
                  15分を超えて待機している実行はありません。
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {selectedGoalBlock ? (
        <section className="space-y-3" aria-label="選択した目標の記録">
          <GoalCard
            block={selectedGoalBlock}
            isToday={isToday}
            breakdownBySession={breakdownBySession}
            stuckBySession={stuckBySession}
          />
        </section>
      ) : null}
    </div>
  );
}
