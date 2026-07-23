import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getRepos, getTodosForDate, type Repo, type Todo } from '@/lib/turso/todos';
import {
  getStepAggregatesForDate,
  getStepsForDate,
  getTodoTimesForDate,
  type TodoStep,
  type TodoStepAggregate,
  type TodoTimes,
} from '@/lib/turso/todo-steps';
import { getActiveThemes, getThemeProgressForDate, type Theme, type ThemeProgress } from '@/lib/turso/themes';
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
import { getSubagentsBySession, type SessionSubagent } from '@/lib/turso/session-subagents';
import {
  getActivePlans,
  getPlanSlugsForDate,
  getPlanStepProgress,
  getResolvablePlanSlugs,
  type ActivePlan,
  type PlanStepProgress,
} from '@/lib/turso/plan-links';
import { buildBoardV2Data } from '@/components/today/board-v2/build';
import { withDevelopmentBoardPreview } from '@/components/today/board-v2/development-preview';

// PCサイドバーの当日ボード要約用API。スマホboardページ（board/page.tsx）と同一部品・同一導出にするため、
// 完全な BoardV2Data を返す（修正01・条件7）。導出は共有純関数 buildBoardV2Data を呼び、二重実装を持たない。
export const dynamic = 'force-dynamic';

const EMPTY_TOTALS: DailyTotals = { sessionDate: '', runMin: 0, waitMin: 0, subMin: 0, sessions: 0 };

function isDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function getJstDate() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const selectedDate = isDate(dateParam) ? dateParam : getJstDate();
    const isToday = selectedDate === getJstDate();

    // board/page.tsx の load() と同じフェイルソフト: 片方のDB（inbox/board）に接続できなくても
    // 取れたデータだけで要約を返す（全体500にしない）。isToday でない日はライブ系を空にする。
    const soft = async <T,>(fallback: T, getter: () => Promise<T>): Promise<T> => {
      try {
        return await getter();
      } catch {
        return fallback;
      }
    };

    const [
      repos,
      todos,
      steps,
      aggByTodo,
      timesByTodo,
      activeThemes,
      themeProgress,
      totals,
      finishedLogs,
      currentSessions,
      stuck,
      subagentsBySession,
      planSlugByTodo,
      resolvablePlanSlugs,
      activePlans,
      planStepProgress,
    ] = await Promise.all([
      soft([] as Repo[], () => getRepos()),
      soft([] as Todo[], () => getTodosForDate(selectedDate)),
      soft([] as TodoStep[], () => getStepsForDate(selectedDate)),
      soft(new Map<string, TodoStepAggregate>(), () => getStepAggregatesForDate(selectedDate)),
      soft(new Map<string, TodoTimes>(), () => getTodoTimesForDate(selectedDate)),
      soft([] as Theme[], () => getActiveThemes()),
      soft(new Map<string, ThemeProgress>(), () => getThemeProgressForDate(selectedDate)),
      soft(EMPTY_TOTALS, () => getDailyTotals(selectedDate)),
      soft([] as FinishedLog[], () => getFinishedLogs(selectedDate)),
      isToday ? soft([] as CurrentSession[], () => getCurrentSessions()) : Promise.resolve([] as CurrentSession[]),
      isToday ? soft([] as StuckWait[], () => getStuckWait(0)) : Promise.resolve([] as StuckWait[]),
      isToday
        ? soft(new Map<string, SessionSubagent[]>(), () => getSubagentsBySession(selectedDate))
        : Promise.resolve(new Map<string, SessionSubagent[]>()),
      soft(new Map<string, string>(), () => getPlanSlugsForDate(selectedDate)),
      soft(new Set<string>(), () => getResolvablePlanSlugs()),
      soft([] as ActivePlan[], () => getActivePlans()),
      soft(new Map<string, PlanStepProgress>(), () => getPlanStepProgress()),
    ]);

    const repoNameBySlug = new Map(repos.map((repo) => [repo.slug, repo.name]));
    const stuckBySession = new Map(stuck.map((s) => [s.sessionKey, s]));
    const stepsByTodo = new Map<string, TodoStep[]>();
    for (const step of steps) {
      const list = stepsByTodo.get(step.todoId) ?? [];
      list.push(step);
      stepsByTodo.set(step.todoId, list);
    }

    const board = withDevelopmentBoardPreview(buildBoardV2Data({
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
      planSlugByTodo,
      resolvablePlanSlugs,
      activePlans,
      planStepProgress,
    }));

    return NextResponse.json({ success: true, board });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to build board summary';
    return NextResponse.json(
      { success: false, error: { code: 'API_ERROR', message } },
      { status: 500 },
    );
  }
}
