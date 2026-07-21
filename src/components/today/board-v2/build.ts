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
import type { ActivePlan, PlanStepProgress } from '@/lib/turso/plan-links';
import type {
  BoardV2Data,
  FinishedTodoItem,
  PlanCardData,
  SessionItem,
  StrayData,
  TaskItem,
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
  // 子05: 計画直結ボード。activePlans=plan_docs bucket='active' の全計画（カード軸）、
  // planStepProgress={ベースslug->工程集計}（カードの済/総）。未指定は空扱い（後方互換・任意）。
  activePlans?: ActivePlan[];
  planStepProgress?: Map<string, PlanStepProgress>;
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

// 取得済みデータから契約型 BoardV2Data を構築する純関数。
// 子05・計画軸: カード＝active計画（＋当日todoが参照する計画）。テーマは planRefs でカードのラベルに降格し、
// どのカードにも解決しないテーマだけテーマのみカード（従来テーマカード相当）で受ける。
// セッション・完了ログ・完了AI todoは、それぞれ所属カード/タスク/未分類へ振り分ける。
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
    activePlans,
    planStepProgress,
  } = input;

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

  // カードの器（子05）: active計画 → 当日todoが参照する計画（非active/未解決も沈黙で消さない）の順に作る。
  const cards: PlanCardData[] = [];
  const cardByPlanSlug = new Map<string, PlanCardData>();
  const newPlanCard = (slug: string, title: string, resolved: boolean, bucket: string) => {
    const card: PlanCardData = {
      planSlug: slug,
      planTitle: title,
      planResolved: resolved,
      bucket,
      theme: null,
      stepProgress: planStepProgress?.get(slug) ?? null,
      progress: null,
      tasks: [],
      cardSessions: [],
      finishedTodos: [],
      finishedLogs: [],
      liveCount: 0,
      waitCount: 0,
    };
    cards.push(card);
    cardByPlanSlug.set(slug, card);
    return card;
  };
  for (const plan of activePlans ?? []) {
    if (!cardByPlanSlug.has(plan.slug)) newPlanCard(plan.slug, plan.title, true, plan.bucket);
  }
  for (const todo of todos) {
    const base = planSlugBase(planSlugByTodo?.get(todo.id) ?? '');
    if (base && !cardByPlanSlug.has(base)) {
      newPlanCard(base, base, resolvablePlanSlugs?.has(base) ?? false, '');
    }
  }

  // テーマの降格（子05）: planRefs が計画カードに解決するテーマは、そのカードの朝の意図ラベルへ。
  // どのカードにも解決しないテーマは、テーマのみカード（従来テーマカード相当）で受ける。
  // homeカード＝テーマ所属のtodo・セッション・完了ログの受け皿。
  const homeCardByThemeId = new Map<string, PlanCardData>();
  for (const theme of activeThemes) {
    let home: PlanCardData | null = null;
    for (const ref of theme.planRefs) {
      const card = cardByPlanSlug.get(planSlugBase(ref));
      if (!card) continue;
      if (!card.theme) card.theme = theme;
      if (!home) home = card;
    }
    if (!home) {
      home = {
        planSlug: '',
        planTitle: theme.name,
        planResolved: false,
        bucket: '',
        theme,
        stepProgress: null,
        progress: themeProgress.get(theme.id) ?? null,
        tasks: [],
        cardSessions: [],
        finishedTodos: [],
        finishedLogs: [],
        liveCount: 0,
        waitCount: 0,
      };
      cards.push(home);
    }
    homeCardByThemeId.set(theme.id, home);
  }

  // やること振り分け: plan_slug→計画カード／themeIdのみ→テーマのhomeカード／どちらも無し→未分類。
  const strayTasks: TaskItem[] = [];
  for (const item of taskItems) {
    const planCard = item.planSlug ? cardByPlanSlug.get(planSlugBase(item.planSlug)) : undefined;
    if (planCard) {
      planCard.tasks.push(item);
      continue;
    }
    const home = item.todo.themeId ? homeCardByThemeId.get(item.todo.themeId) : undefined;
    if (home) home.tasks.push(item);
    else strayTasks.push(item);
  }

  // セッション振り分け: todoId一致→TaskItem直下／themeId一致→homeカード直下／どちらも無し→未分類。
  const straySessions: SessionItem[] = [];
  for (const item of sessionItems) {
    const s = item.session;
    const taskItem = s.todoId ? taskItemById.get(s.todoId) : undefined;
    if (taskItem) {
      taskItem.sessions.push(item);
      continue;
    }
    const home = s.themeId ? homeCardByThemeId.get(s.themeId) : undefined;
    if (home) {
      home.cardSessions.push(item);
      continue;
    }
    straySessions.push(item);
  }

  // 完了AI todo: plan_slug→計画カード／テーマ一致→homeカード折りたたみ／無所属→未分類枠（修正01・条件4）。
  const strayFinishedTodos: FinishedTodoItem[] = [];
  for (const todo of todos) {
    if (todo.assignee !== 'ai' || todo.status !== 'done') continue;
    const item: FinishedTodoItem = {
      todo,
      doneSteps: (stepsByTodo.get(todo.id) ?? []).filter((step) => step.status === 'done').length,
      runMin: timesByTodo.get(todo.id)?.runMin ?? null,
    };
    const planCard = cardByPlanSlug.get(planSlugBase(planSlugByTodo?.get(todo.id) ?? ''));
    if (planCard) {
      planCard.finishedTodos.push(item);
      continue;
    }
    const home = todo.themeId ? homeCardByThemeId.get(todo.themeId) : undefined;
    if (home) home.finishedTodos.push(item);
    else strayFinishedTodos.push(item);
  }

  // 完了ログ: parentがテーマ名一致→そのテーマのhomeカード／不一致→未分類（parent別グループ）。
  const strayLogsByParent = new Map<string, { entry: string; count: number }[]>();
  for (const { log, count } of dedupeLogs(finishedLogs)) {
    const theme = log.parent ? themeByName.get(log.parent) : undefined;
    const home = theme ? homeCardByThemeId.get(theme.id) : undefined;
    if (home) {
      home.finishedLogs.push({ entry: log.entry, count });
    } else {
      const parent = log.parent || '新見出し';
      const list = strayLogsByParent.get(parent) ?? [];
      list.push({ entry: log.entry, count });
      strayLogsByParent.set(parent, list);
    }
  }

  // カード帯のライブ数を集計し、当日動きのあるカードを先・動きなしの静かなカードを後ろへ（作成順は保つ）。
  for (const card of cards) {
    const cardAllSessions = [...card.tasks.flatMap((t) => t.sessions), ...card.cardSessions];
    card.liveCount = cardAllSessions.filter(
      (s) => s.session.state === 'run' || s.session.state === 'sub',
    ).length;
    card.waitCount = cardAllSessions.filter((s) => s.session.state === 'wait').length;
  }
  const hasActivity = (card: PlanCardData) =>
    card.tasks.length > 0 ||
    card.cardSessions.length > 0 ||
    card.finishedTodos.length > 0 ||
    card.finishedLogs.length > 0;
  const planCards = [...cards.filter(hasActivity), ...cards.filter((card) => !hasActivity(card))];

  // 未分類（plan_slugもテーマも無いtask・session・完了AI todo・ログ）＝現状維持。
  const stray: StrayData = {
    tasks: strayTasks,
    sessions: straySessions,
    finishedTodos: strayFinishedTodos,
    finishedLogs: [...strayLogsByParent.entries()].map(([parent, items]) => ({ parent, items })),
  };

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
    planCards,
    stray,
    aiTargets,
  };
}
