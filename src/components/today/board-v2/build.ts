// board-v2 データ組み立て（純関数・共有正本）。
// 正本モック: ~/Private/personal-os/my-brain/areas/ai運用/plans/active/2026-07-21-ボードUI計画統合/references/board-mock-v2.html
// board/page.tsx（サーバーコンポーネント）と /api/board/summary（PCサイドバー用API）の両方から呼ぶ。
// 取得済みデータ（新クエリなし）から契約型 BoardV2Data を構築する。Date型を含まず全て string/number/null（JSONセーフ）。
import type {
  CurrentSession,
  DailyTotals,
  FinishedLog,
  StuckWait,
} from '@/lib/turso/personal-os-board';
import type { Todo } from '@/lib/turso/todos';
import type { TodoStep, TodoStepAggregate, TodoTimes } from '@/lib/turso/todo-steps';
import type { Theme, ThemeProgress } from '@/lib/turso/themes';
import type { SessionSubagent } from '@/lib/turso/session-subagents';
import { deriveBoardStatus } from '@/lib/board-status';
import type {
  AskItem,
  BoardV2Data,
  FinishedTodoItem,
  SessionItem,
  StrayData,
  TaskItem,
  ThemeCardData,
} from './types';

export interface BuildInput {
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
  // 子02: 計画リンク。planSlugByTodo={todoId->plan_slug}、resolvablePlanSlugs=plan_docsに解決できる program_slug 集合。
  // 未指定は「計画リンクなし」として扱う（後方互換・任意）。
  planSlugByTodo?: Map<string, string>;
  resolvablePlanSlugs?: Set<string>;
}

// plan_slug のベース slug（`slug#NN` → `slug`）。plan_links.ts の planSlugBase と同義（build.ts は純関数のため内蔵）。
function planSlugBase(planSlug: string): string {
  const hash = planSlug.indexOf('#');
  return hash >= 0 ? planSlug.slice(0, hash) : planSlug;
}

// 「終わったこと」ログの表示時de-dup（連続する同一entryを ×N バッジにまとめる）。
export function dedupeLogs(logs: FinishedLog[]): { log: FinishedLog; count: number }[] {
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

// 取得済みデータ（新クエリなし）から契約型 BoardV2Data を構築する純関数。
// テーマ軸へ一本化: セッション・完了ログ・完了AI todoを、それぞれ所属テーマ/タスク/未分類へ振り分ける。
export function buildBoardV2Data(input: BuildInput): BoardV2Data {
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
    planSlugByTodo,
    resolvablePlanSlugs,
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
    const planSlug = planSlugByTodo?.get(todo.id) ?? '';
    const planResolved = planSlug !== '' && (resolvablePlanSlugs?.has(planSlugBase(planSlug)) ?? false);
    const item: TaskItem = {
      todo,
      steps: stepsByTodo.get(todo.id) ?? [],
      agg: aggByTodo.get(todo.id) ?? null,
      times: timesByTodo.get(todo.id) ?? null,
      sessions: [],
      repoName: repoNameBySlug.get(todo.repo) ?? todo.repo,
      planSlug,
      planResolved,
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

  // 完了AI todo: テーマ一致→そのテーマ折りたたみ／無所属→未分類枠（修正01・条件4）。
  const finishedTodoByTheme = new Map<string, FinishedTodoItem[]>();
  const strayFinishedTodos: FinishedTodoItem[] = [];
  for (const todo of todos) {
    if (todo.assignee !== 'ai' || todo.status !== 'done') continue;
    const item: FinishedTodoItem = {
      todo,
      doneSteps: (stepsByTodo.get(todo.id) ?? []).filter((step) => step.status === 'done').length,
      runMin: timesByTodo.get(todo.id)?.runMin ?? null,
    };
    if (todo.themeId && themeById.has(todo.themeId)) {
      const list = finishedTodoByTheme.get(todo.themeId) ?? [];
      list.push(item);
      finishedTodoByTheme.set(todo.themeId, list);
    } else {
      strayFinishedTodos.push(item);
    }
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

  // 未分類（テーマ無所属のtask・session・完了AI todo・ログ）。
  const stray: StrayData = {
    tasks: taskItems.filter((item) => !item.todo.themeId || !themeById.has(item.todo.themeId)),
    sessions: straySessions,
    finishedTodos: strayFinishedTodos,
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
