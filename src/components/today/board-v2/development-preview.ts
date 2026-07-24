import type { CurrentSession } from '@/lib/turso/personal-os-board';
import type { Theme } from '@/lib/turso/themes';
import type { Todo } from '@/lib/turso/todos';
import type { TodoStep, TodoStepAggregate, TodoTimes } from '@/lib/turso/todo-steps';
import type { BoardV2Data, PlanCardData, SessionItem, TaskItem, ThemeGroup } from './types';

const SAMPLE_TIMESTAMP = '2026-07-23T09:00:00+09:00';

function sampleTheme(
  id: string,
  name: string,
  purpose: string,
  planRefs: string[],
  sortOrder: number,
): Theme {
  return {
    id,
    name,
    purpose,
    doneCriteria: '',
    goalRef: '',
    planRefs,
    sortOrder,
    status: 'active',
    createdAt: SAMPLE_TIMESTAMP,
    updatedAt: SAMPLE_TIMESTAMP,
  };
}

function sampleSession(
  sessionKey: string,
  runtime: 'codex' | 'claude',
  state: 'run' | 'wait',
  repo: string,
  plan: string,
  goal: string,
  now: string,
  todoId: string,
  themeId: string,
): SessionItem {
  const session: CurrentSession = {
    sessionKey,
    goal,
    now,
    type: runtime,
    repo,
    model: runtime === 'codex' ? 'GPT-5' : 'Claude Opus',
    plan,
    state,
    updatedAt: SAMPLE_TIMESTAMP,
    subN: runtime === 'codex' && state === 'run' ? 1 : 0,
    todoId,
    themeId,
  };
  return {
    session,
    stuck:
      state === 'wait'
        ? {
            sessionKey,
            goal,
            repo,
            waitingSince: '2026-07-23T14:28:00+09:00',
            waitMin: 12,
          }
        : null,
    subagents: [],
  };
}

function sampleTodo(
  id: string,
  title: string,
  date: string,
  repo: string,
  themeId: string,
  route: 'plan' | 'single' = 'plan',
): Todo {
  return {
    id,
    title,
    note: '',
    doDate: date,
    dueDate: '',
    repo,
    assignee: 'ai',
    status: 'open',
    aiStatus: '実行中',
    source: 'development-preview',
    goalRef: '',
    route,
    completedBy: '',
    themeId,
    carriedFrom: '',
    awaitingSince: '',
    question: '',
    questionChoices: [],
    questionAllowFree: true,
    questionGate: false,
    answer: '',
    answeredAt: '',
    answerConsumedAt: '',
    createdAt: SAMPLE_TIMESTAMP,
    updatedAt: SAMPLE_TIMESTAMP,
    completedAt: '',
  };
}

function sampleSteps(todoId: string, titles: string[], done: number, doing: number): TodoStep[] {
  return titles.map((title, index) => ({
    id: `${todoId}-step-${index + 1}`,
    todoId,
    seq: index + 1,
    title,
    kind: index === titles.length - 1 ? 'review' : 'step',
    status: index < done ? 'done' : index === doing ? 'doing' : 'todo',
    doneAt: index < done ? SAMPLE_TIMESTAMP : '',
    elapsedMin: index < done ? 24 + index * 8 : index === doing ? 31 : null,
  }));
}

function sampleTask(
  todo: Todo,
  planSlug: string,
  repoName: string,
  steps: TodoStep[],
  sessions: SessionItem[],
): TaskItem {
  const done = steps.filter((step) => step.status === 'done').length;
  const total = steps.filter((step) => step.status !== 'skipped').length;
  const agg: TodoStepAggregate = {
    todoId: todo.id,
    total,
    done,
    skipped: 0,
    pending: total - done,
    pct: total > 0 ? Math.round((100 * done) / total) : null,
  };
  const times: TodoTimes = { todoId: todo.id, runMin: 74, waitMin: 12 };
  return { todo, steps, agg, times, sessions, repoName, planSlug, planResolved: false };
}

function samplePlan(
  planSlug: string,
  planTitle: string,
  bucket: 'active' | 'planning',
  theme: Theme,
  task: TaskItem,
  done: number,
  total: number,
  finishedLogs: string[] = [],
): PlanCardData {
  const sessions = task.sessions;
  return {
    planSlug,
    planTitle,
    planResolved: false,
    bucket,
    repoPath: task.repoName === 'Focusmap' ? '/Users/kitamuranaohiro/Private/projects/active/focusmap' : '',
    theme,
    stepProgress: { done, total, pct: total > 0 ? Math.round((100 * done) / total) : null },
    progress: null,
    tasks: [task],
    cardSessions: [],
    finishedTodos: [],
    finishedLogs: finishedLogs.map((entry) => ({ entry, count: 1 })),
    liveCount: sessions.filter((item) => item.session.state === 'run').length,
    waitCount: sessions.filter((item) => item.session.state === 'wait').length,
  };
}

function sampleGroup(theme: Theme, plans: PlanCardData[]): ThemeGroup {
  const stepDone = plans.reduce((sum, plan) => sum + (plan.stepProgress?.done ?? 0), 0);
  const stepTotal = plans.reduce((sum, plan) => sum + (plan.stepProgress?.total ?? 0), 0);
  return {
    key: theme.id,
    theme,
    title: theme.name,
    plans,
    planCount: plans.length,
    stepDone,
    stepTotal,
    stepPct: stepTotal > 0 ? Math.round((100 * stepDone) / stepTotal) : null,
    liveCount: plans.reduce((sum, plan) => sum + plan.liveCount, 0),
    waitCount: plans.reduce((sum, plan) => sum + plan.waitCount, 0),
    hasActivity: true,
    dayState: null,
    carriedFromDay: null,
    dayVersion: null,
  };
}

function createDevelopmentPreview(selectedDate: string, isToday: boolean): BoardV2Data {
  const focusmapTheme = sampleTheme(
    'preview-theme-focusmap',
    'FocusmapでAIとの協業を見える化する',
    '目的・計画・AIの現在地を、1日の中で迷わず判断できる状態にする',
    ['preview-daily-ui', 'preview-session-hook'],
    1,
  );
  const workTheme = sampleTheme(
    'preview-theme-work',
    '仕事の実行環境を整理する',
    'リポジトリごとの計画と単発作業を分け、今日の成果を残す',
    ['preview-work-ops'],
    2,
  );

  const dailyTodo = sampleTodo(
    'preview-todo-daily-ui',
    'DailyをTheme・Plan中心に再設計',
    selectedDate,
    'focusmap',
    focusmapTheme.id,
  );
  const dailySessions = [
    sampleSession(
      'preview-codex-daily-ui',
      'codex',
      'run',
      'focusmap',
      'preview-daily-ui',
      'Daily UIを実装',
      'モックデータで完成形を表示中',
      dailyTodo.id,
      focusmapTheme.id,
    ),
    sampleSession(
      'preview-claude-daily-review',
      'claude',
      'wait',
      'focusmap',
      'preview-daily-ui',
      'Daily設計レビュー',
      'テーマと計画の見せ方を確認待ち',
      dailyTodo.id,
      focusmapTheme.id,
    ),
  ];
  const dailyTask = sampleTask(
    dailyTodo,
    'preview-daily-ui#01',
    'Focusmap',
    sampleSteps(dailyTodo.id, ['表示目的を確定', 'テーマ・計画カードを構成', 'AI状態を統合', '実機で確認'], 2, 2),
    dailySessions,
  );
  const dailyPlan = samplePlan(
    'preview-daily-ui',
    'DailyをTheme・Plan中心に再設計',
    'active',
    focusmapTheme,
    dailyTask,
    3,
    7,
    ['既存UIの情報構造を整理'],
  );

  const hookTodo = sampleTodo(
    'preview-todo-session-hook',
    'HookでセッションをPlanへ紐付ける',
    selectedDate,
    'ai-platform',
    focusmapTheme.id,
  );
  const hookSessions = [
    sampleSession(
      'preview-codex-hook',
      'codex',
      'run',
      'ai-platform',
      'preview-session-hook',
      'Hookの所属判定を設計',
      '単発・Theme・Planの判定境界を整理中',
      hookTodo.id,
      focusmapTheme.id,
    ),
  ];
  const hookTask = sampleTask(
    hookTodo,
    'preview-session-hook#01',
    'AI基盤',
    sampleSteps(hookTodo.id, ['入力を受け取る', 'repoを判定', 'Plan候補を提示', '人間確定後に保存'], 1, 1),
    hookSessions,
  );
  const hookPlan = samplePlan(
    'preview-session-hook',
    'HookでセッションをPlanへ紐付ける',
    'planning',
    focusmapTheme,
    hookTask,
    1,
    5,
  );

  const workTodo = sampleTodo(
    'preview-todo-work-ops',
    '採用業務の行動とAI作業をつなぐ',
    selectedDate,
    'shigoto',
    workTheme.id,
  );
  const workSessions = [
    sampleSession(
      'preview-claude-work-review',
      'claude',
      'wait',
      'shigoto',
      'preview-work-ops',
      '運用手順をレビュー',
      '人間の確認項目を整理して確認待ち',
      workTodo.id,
      workTheme.id,
    ),
  ];
  const workTask = sampleTask(
    workTodo,
    'preview-work-ops#01',
    '仕事',
    sampleSteps(workTodo.id, ['今日の対象を決める', 'AIへ実行を渡す', '成果を人間が確認', '完了を記録'], 3, 3),
    workSessions,
  );
  const workPlan = samplePlan(
    'preview-work-ops',
    '採用業務の行動とAI作業をつなぐ',
    'active',
    workTheme,
    workTask,
    4,
    6,
    ['午前の管理表確認を完了'],
  );

  const focusmapGroup = sampleGroup(focusmapTheme, [dailyPlan, hookPlan]);
  const workGroup = sampleGroup(workTheme, [workPlan]);
  const singleTodo = sampleTodo(
    'preview-single-task',
    'Arcで参考画面を確認する（単発）',
    selectedDate,
    'focusmap',
    '',
    'single',
  );
  const singleTask = sampleTask(singleTodo, '', 'Focusmap', [], []);
  const plans = [dailyPlan, hookPlan, workPlan];

  return {
    selectedDate,
    isToday,
    isPreview: true,
    progressPct: 50,
    liveTotal: 2,
    waitTotal: 2,
    runMin: 96,
    waitMinTotal: 24,
    themeGroups: [focusmapGroup, workGroup],
    planCards: plans,
    stray: {
      tasks: [singleTask],
      sessions: [],
      finishedTodos: [],
      finishedLogs: [
        { parent: '単発タスク', items: [{ entry: 'UI参考画像を整理してアーカイブ', count: 1 }] },
        { parent: '未分類', items: [{ entry: '調査メモを確認して終了', count: 1 }] },
      ],
    },
    unplannedSessions: [],
    aiTargets: [
      { id: dailyTodo.id, title: dailyTodo.title },
      { id: hookTodo.id, title: hookTodo.title },
      { id: workTodo.id, title: workTodo.title },
    ],
  };
}

function hasStructuredPlanContent(board: BoardV2Data) {
  return board.themeGroups.length > 0 || board.planCards.length > 0;
}

// 本番では必ず実データだけを返す。開発環境でもTheme/Planが取れていれば実データを優先する。
// 完了ログや計画外sessionだけが残る場合は完成形を確認できないため、実データと混ぜず画面全体をサンプルへ差し替える。
export function withDevelopmentBoardPreview(board: BoardV2Data): BoardV2Data {
  if (process.env.NODE_ENV === 'production' || hasStructuredPlanContent(board)) return board;
  return createDevelopmentPreview(board.selectedDate, board.isToday);
}
