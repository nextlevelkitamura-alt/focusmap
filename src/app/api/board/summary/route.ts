import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getTodosForDate, type Todo } from '@/lib/turso/todos';
import { getStepAggregatesForDate, type TodoStepAggregate } from '@/lib/turso/todo-steps';
import { getActiveThemes, getThemeProgressForDate } from '@/lib/turso/themes';
import { getCurrentSessions, type CurrentSession } from '@/lib/turso/personal-os-board';
import { deriveBoardStatus } from '@/lib/board-status';

// PCサイドバー上段の「当日ボード要約」用の軽量サブセット。
// board/page.tsx の buildBoardV2Data 全体は複製せず、必要最小の導出だけを行う（レーンC2）。
export const dynamic = 'force-dynamic';

interface SummaryTask {
  id: string;
  title: string;
  statusLabel: string | null;
}

interface SummaryTheme {
  id: string;
  name: string;
  pct: number | null;
  liveCount: number;
  waitCount: number;
  openTasks: SummaryTask[];
  doneCount: number;
}

interface BoardSummary {
  progressPct: number | null;
  liveTotal: number;
  waitTotal: number;
  asksCount: number;
  themes: SummaryTheme[];
}

function isDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function getJstDate() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// AI open タスクの状態ラベルはステップ集計から導出（board/page.tsx と同じ deriveBoardStatus を流用）。
function statusLabelFor(todo: Todo, agg: TodoStepAggregate | undefined): string | null {
  if (todo.assignee !== 'ai') return null;
  return deriveBoardStatus(todo, agg).label;
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
    // 取れたデータだけで要約を返す（全体500にしない）。
    const soft = async <T,>(fallback: T, getter: () => Promise<T>): Promise<T> => {
      try {
        return await getter();
      } catch {
        return fallback;
      }
    };
    const [todos, aggByTodo, activeThemes, themeProgress, currentSessions] = await Promise.all([
      soft([] as Todo[], () => getTodosForDate(selectedDate)),
      soft(new Map<string, TodoStepAggregate>(), () => getStepAggregatesForDate(selectedDate)),
      soft([], () => getActiveThemes()),
      soft(new Map(), () => getThemeProgressForDate(selectedDate)),
      isToday ? soft([] as CurrentSession[], () => getCurrentSessions()) : Promise.resolve([] as CurrentSession[]),
    ]);

    const todosById = new Map(todos.map((todo) => [todo.id, todo]));
    const themeIds = new Set(activeThemes.map((theme) => theme.id));

    // セッションの所属テーマ判定: session.todoId→そのtodoのthemeId、無ければ session.themeId。
    const themeIdForSession = (session: CurrentSession): string | null => {
      const linked = session.todoId ? todosById.get(session.todoId) : undefined;
      const viaTodo = linked?.themeId;
      if (viaTodo && themeIds.has(viaTodo)) return viaTodo;
      if (session.themeId && themeIds.has(session.themeId)) return session.themeId;
      return null;
    };

    // 全体プログレス（board/page.tsx と同一導出: 済todo/全todo）。
    const totalCount = todos.length;
    const doneCount = todos.filter((todo) => todo.status === 'done').length;
    const progressPct = totalCount === 0 ? null : Math.round((doneCount / totalCount) * 100);

    const isLive = (state: string) => state === 'run' || state === 'sub';
    const liveTotal = currentSessions.filter((s) => isLive(s.state)).length;
    const waitTotal = currentSessions.filter((s) => s.state === 'wait').length;

    // きみの番件数: (a) 質問中のAI todo, (b) 確認待ちセッション。
    let asksCount = 0;
    for (const todo of todos) {
      if (todo.assignee !== 'ai') continue;
      if (deriveBoardStatus(todo, aggByTodo.get(todo.id)).tone === 'question') asksCount += 1;
    }
    asksCount += waitTotal;

    // テーマ別のライブ/待ち件数を集計。
    const liveByTheme = new Map<string, number>();
    const waitByTheme = new Map<string, number>();
    for (const session of currentSessions) {
      const themeId = themeIdForSession(session);
      if (!themeId) continue;
      if (isLive(session.state)) liveByTheme.set(themeId, (liveByTheme.get(themeId) ?? 0) + 1);
      else if (session.state === 'wait') waitByTheme.set(themeId, (waitByTheme.get(themeId) ?? 0) + 1);
    }

    const themes: SummaryTheme[] = activeThemes.map((theme) => {
      // open のやること = self（完了打消しは status で表現）または AI open。
      const openTasks: SummaryTask[] = todos
        .filter(
          (todo) =>
            todo.themeId === theme.id && (todo.assignee === 'self' || todo.status !== 'done'),
        )
        .map((todo) => ({
          id: todo.id,
          title: todo.title,
          statusLabel: statusLabelFor(todo, aggByTodo.get(todo.id)),
        }));
      const progress = themeProgress.get(theme.id);
      return {
        id: theme.id,
        name: theme.name,
        pct: progress?.pct ?? null,
        liveCount: liveByTheme.get(theme.id) ?? 0,
        waitCount: waitByTheme.get(theme.id) ?? 0,
        openTasks,
        doneCount: progress?.done ?? 0,
      };
    });

    const summary: BoardSummary = {
      progressPct,
      liveTotal,
      waitTotal,
      asksCount,
      themes,
    };

    return NextResponse.json({ success: true, summary });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to build board summary';
    return NextResponse.json(
      { success: false, error: { code: 'API_ERROR', message } },
      { status: 500 },
    );
  }
}
