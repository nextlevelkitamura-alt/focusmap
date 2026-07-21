// board-v2 契約（30分スプリント・レーンD先行確定）
// 正本モック: ~/Private/personal-os/my-brain/areas/ai運用/plans/active/2026-07-21-ボードUI計画統合/references/board-mock-v2.html
// 骨子: テーマ軸一本化（独立3区画を廃止）＋「きみの番」レーン＋未分類枠＋ライブ帯。
// レーン分担（同一ファイルを2レーンで触らない）:
//   レーンA: board-v2/theme-card.tsx（ThemeCardV2・TaskRow・SessionRow・FinishedFold）
//   レーンB: board-v2/ask-lane.tsx / board-v2/stray-box.tsx / board-v2/day-header.tsx
//   レーンC: board/page.tsx 組替え（BoardV2Data 構築）・PCサイドバー統合・レスポンシブ
// この型定義の変更が必要になったレーンは自走せず指揮官へ差し戻す。

import type { CurrentSession, StuckWait } from '@/lib/turso/personal-os-board';
import type { Todo } from '@/lib/turso/todos';
import type { TodoStep, TodoStepAggregate, TodoTimes } from '@/lib/turso/todo-steps';
import type { Theme, ThemeProgress } from '@/lib/turso/themes';
import type { SessionSubagent } from '@/lib/turso/session-subagents';

export interface SessionItem {
  session: CurrentSession;
  stuck: StuckWait | null;
  subagents: SessionSubagent[];
}

export interface TaskItem {
  todo: Todo;
  steps: TodoStep[];
  agg: TodoStepAggregate | null;
  times: TodoTimes | null;
  sessions: SessionItem[]; // session.todoId === todo.id のライブ行（やること行の直下にぶら下げる）
  repoName: string;
}

export interface FinishedTodoItem {
  todo: Todo;
  doneSteps: number;
  runMin: number | null;
}

export interface ThemeCardData {
  theme: Theme | null; // null = 使わない（未分類は stray 枠で扱う）
  progress: ThemeProgress | null;
  tasks: TaskItem[]; // open のやること（self完了打消しは todo.status で判定）
  themeSessions: SessionItem[]; // todoId 無しで themeId だけ一致するライブ行（テーマ直下に表示）
  finishedTodos: FinishedTodoItem[]; // このテーマの完了AI todo（折りたたみ内）
  finishedLogs: { entry: string; count: number }[]; // このテーマ名を parent に持つ session_logs
  liveCount: number; // state==='run'|'sub' のセッション数（テーマ帯ライブ帯）
  waitCount: number; // state==='wait'
}

export type AskItem =
  | { kind: 'question'; todo: Todo; themeName: string | null } // AIの質問（questionGate=falseは回答UI・trueは注意文）
  | { kind: 'wait'; session: CurrentSession; waitMin: number; themeName: string | null }; // 確認待ちセッション

export interface StrayData {
  tasks: TaskItem[]; // themeId 無所属の open todo
  sessions: SessionItem[]; // todoId/themeId とも無所属のライブセッション
  finishedLogs: { parent: string; items: { entry: string; count: number }[] }[]; // テーマ名に一致しない parent のログ
}

export interface BoardV2Data {
  selectedDate: string;
  isToday: boolean;
  progressPct: number | null; // 全テーマ+未分類の 済やること/全やること（対象0件なら null）
  liveTotal: number;
  waitTotal: number;
  runMin: number; // 本日サマリ相当はヘッダー1行へ集約（daily totals）
  waitMinTotal: number;
  asks: AskItem[];
  themes: ThemeCardData[];
  stray: StrayData;
  aiTargets: { id: string; title: string }[]; // FixReattach 用
}
