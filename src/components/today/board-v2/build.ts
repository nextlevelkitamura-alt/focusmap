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
  ThemeGroup,
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

  // セッション振り分け（子05レーンB・優先順）:
  //  (a) todoId 一致 → その TaskItem 直下（工程行の下にぶら下げる・既存維持）
  //  (b) plan 宣言（board.py update --plan）が計画カードのベースslugに解決 → その計画カード直下（新経路）
  //  (c) themeId 一致 → テーマの home カード直下（既存維持）
  //  (d) どれも無い → 計画外エージェント（未分類ではなく専用ゾーン unplannedSessions へ）
  // (b) は plan が空、または planSlugBase(plan) がどのカードにも解決しない時は素通りするので (a)(c) を退行させない。
  const unplannedSessions: SessionItem[] = [];
  for (const item of sessionItems) {
    const s = item.session;
    const taskItem = s.todoId ? taskItemById.get(s.todoId) : undefined;
    if (taskItem) {
      taskItem.sessions.push(item);
      continue;
    }
    const planCard = s.plan ? cardByPlanSlug.get(planSlugBase(s.plan)) : undefined;
    if (planCard) {
      planCard.cardSessions.push(item);
      continue;
    }
    const home = s.themeId ? homeCardByThemeId.get(s.themeId) : undefined;
    if (home) {
      home.cardSessions.push(item);
      continue;
    }
    unplannedSessions.push(item);
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

  // 子07・段階0: 計画カードをテーマ(themes active)の器へ束ねる（既存3段の上にテーマ層を1枚かぶせる）。
  // real plan card は build 中に card.theme（planRefs 先勝ち）で所属テーマが決まっている。
  // テーマのみカード（planSlug='' ＝ planRefs が全部未解決のテーマ）は card.theme が自テーマ。
  // どのテーマにも属さない計画カード（card.theme===null）は「テーマ未設定」へまとめ、沈黙させない。
  // 空のテーマのみカードは器（テーマ）の重複になるので表示対象から外す（テーマ自体は planCount=0 の「動きなし」で残る）。
  const makeGroup = (key: string, theme: Theme | null, title: string): ThemeGroup => ({
    key,
    theme,
    title,
    plans: [],
    planCount: 0,
    stepDone: 0,
    stepTotal: 0,
    stepPct: null,
    liveCount: 0,
    waitCount: 0,
    hasActivity: false,
  });
  const themeGroupById = new Map<string, ThemeGroup>();
  const orderedGroups: ThemeGroup[] = [];
  for (const theme of activeThemes) {
    const group = makeGroup(theme.id, theme, theme.name);
    themeGroupById.set(theme.id, group);
    orderedGroups.push(group);
  }
  const unassigned = makeGroup('unassigned', null, 'テーマ未設定');
  orderedGroups.push(unassigned);

  for (const card of planCards) {
    if (card.planSlug === '' && !hasActivity(card)) continue; // 空のテーマのみカードは畳む（沈黙ではなくテーマ側で「動きなし」表示）
    const group = (card.theme ? themeGroupById.get(card.theme.id) : undefined) ?? unassigned;
    group.plans.push(card);
  }

  for (const group of orderedGroups) {
    for (const card of group.plans) {
      if (card.planSlug !== '') group.planCount += 1;
      const prog = card.planSlug === '' ? card.progress : card.stepProgress;
      group.stepDone += prog?.done ?? 0;
      group.stepTotal += prog?.total ?? 0;
      group.liveCount += card.liveCount;
      group.waitCount += card.waitCount;
      if (hasActivity(card)) group.hasActivity = true;
    }
    group.stepPct = group.stepTotal > 0 ? Math.round((100 * group.stepDone) / group.stepTotal) : null;
  }

  // テーマ未設定は計画カードが無ければ出さない。active テーマは0計画でも「動きなし」で残す（沈黙させない）。
  const visibleGroups = orderedGroups.filter((group) => group.theme !== null || group.plans.length > 0);
  // 当日動きのあるテーマを先・静かなテーマを後ろへ（作成順は保つ・既存カードソートと同型）。
  const themeGroups = [
    ...visibleGroups.filter((group) => group.hasActivity),
    ...visibleGroups.filter((group) => !group.hasActivity),
  ];

  // 未分類（plan_slugもテーマも無いtask・完了AI todo・ログ）。
  // 子05レーンB: 無所属セッションは stray ではなく unplannedSessions（計画外エージェント）へ移したため、
  // stray.sessions は後方互換で残しつつ常に空（既存フィールド削除・改名なし）。
  const stray: StrayData = {
    tasks: strayTasks,
    sessions: [],
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
    themeGroups,
    planCards,
    stray,
    unplannedSessions,
    aiTargets,
  };
}
