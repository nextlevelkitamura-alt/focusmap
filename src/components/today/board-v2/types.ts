// board-v2 契約（30分スプリント・レーンD先行確定）
// 正本モック: ~/Private/personal-os/my-brain/areas/ai運用/plans/active/2026-07-21-ボードUI計画統合/references/board-mock-v2.html
// 骨子: 計画軸（子05: カード＝active計画・テーマは朝の意図ラベルへ降格）＋未分類枠＋ライブ帯。
// 「きみの番」レーンは修正02で廃止（質問回答はタスク行内・確認待ちはセッション行の琥珀表示で示す）。
// レーン分担（同一ファイルを2レーンで触らない）:
//   レーンA: board-v2/theme-card.tsx（ThemeCardV2・TaskRow・SessionRow・FinishedFold）
//   レーンB: board-v2/stray-box.tsx / board-v2/day-header.tsx
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
  // 子02: 計画リンク（todos.plan_slug）。planSlug='' はリンクなし。
  // planResolved=false は plan_docs に解決しない slug＝グレー非リンク表示（沈黙故障させない）。
  planSlug: string;
  planResolved: boolean;
}

export interface FinishedTodoItem {
  todo: Todo;
  doneSteps: number;
  runMin: number | null;
}

// 子05「計画直結ボード」: カードの軸をテーマから計画へ改訂。
// planSlug!=='' が計画カード（plan_docs bucket='active' の全計画＋当日todoが参照する計画）。
// planSlug==='' はテーマのみカード（planRefs がどの計画カードにも解決しないテーマの受け皿・従来テーマカード相当）。
export interface PlanCardData {
  planSlug: string; // ベースslug（`slug#NN` の # 以降なし）。'' はテーマのみカード
  planTitle: string; // plan_docs.title（テーマのみカードは theme.name／未解決slugはslugそのまま）
  planResolved: boolean; // plan_docs に解決するか（false=グレー非リンク・沈黙故障させない）
  bucket: string; // plan_docs.bucket（'active' 等。todo由来の非active・未解決・テーマのみは ''）
  theme: Theme | null; // 朝の意図ラベル（planRefs でこの計画を指すテーマ。カード上部の小ラベルに降格）
  stepProgress: { done: number; total: number; pct: number | null } | null; // 計画カードの済/総＝plan_slug一致のtodo_steps全期間集計（SQL導出）
  progress: ThemeProgress | null; // テーマのみカードの済/総（従来の当日todo集計）
  tasks: TaskItem[]; // open のやること（plan_slug付きAI todoは見出し行なしで工程直下描画・self完了打消しは todo.status で判定）
  cardSessions: SessionItem[]; // todoId 無しで themeId だけ一致するライブ行（カード直下に表示）
  finishedTodos: FinishedTodoItem[]; // このカードの完了AI todo（折りたたみ内）
  finishedLogs: { entry: string; count: number }[]; // このカードのテーマ名を parent に持つ session_logs
  liveCount: number; // state==='run'|'sub' のセッション数（カード帯ライブ帯）
  waitCount: number; // state==='wait'
}

export interface StrayData {
  tasks: TaskItem[]; // themeId 無所属の open todo
  sessions: SessionItem[]; // todoId/themeId とも無所属のライブセッション
  finishedTodos: FinishedTodoItem[]; // テーマ無所属の完了AI todo（修正01・条件4）
  finishedLogs: { parent: string; items: { entry: string; count: number }[] }[]; // テーマ名に一致しない parent のログ
}

// 子07「テーマ上位・4段化」: themes(active) を最上位の器にし、planRefs で解決した計画カード群を束ねる。
// 段階0=テーマカード（この型）→ 段階1=PlanCardData[]（既存 PlanCardV2 をそのまま入れ子）→ 段階2/3=工程・AIレーン（子06・不変）。
// plans は表示対象カードだけ（real plan card＝planSlug!==''、＋活動のあるテーマのみカード）。空のテーマのみカードは器の重複になるので畳む。
export interface ThemeGroup {
  key: string; // theme.id ／ 'unassigned'（テーマ未設定の受け皿）
  theme: Theme | null; // null=テーマ未設定
  title: string; // theme.name ／ 'テーマ未設定'
  plans: PlanCardData[]; // 配下の計画カード（PlanCardV2 を入れ子で描画）
  planCount: number; // 束ねる計画数（real plan card＝planSlug!==''）。0=「動きなし」1行表示
  stepDone: number; // 配下計画のstep集計合算（済）
  stepTotal: number; // 同（総）
  stepPct: number | null; // stepTotal>0 の時だけ数値（0件は null）
  liveCount: number; // 配下計画の稼働(run/sub)合算
  waitCount: number; // 配下計画の確認待ち(wait)合算
  hasActivity: boolean; // 当日動きの有無（並び順=活動ありを先へ）
}

export interface BoardV2Data {
  selectedDate: string;
  isToday: boolean;
  progressPct: number | null; // 全テーマ+未分類の 済やること/全やること（対象0件なら null）
  liveTotal: number;
  waitTotal: number;
  runMin: number; // 本日サマリ相当はヘッダー1行へ集約（daily totals）
  waitMinTotal: number;
  themeGroups: ThemeGroup[]; // 子07: 最上位＝テーマの器（段階0）。各テーマ配下に planCards を入れ子で束ねる
  planCards: PlanCardData[]; // 子05: フラットな計画カード列（子07のテーマ振り分け前・後方互換で残置）
  stray: StrayData;
  // 子05レーンB「計画外エージェント」: plan/theme/todo のどれも宣言せず動いているセッション。
  // 未分類(StrayData.sessions)から分離した専用ゾーン。plan を宣言すると build 側で計画カードへ入り、次ポーリングでここから消える。
  unplannedSessions: SessionItem[];
  aiTargets: { id: string; title: string }[]; // FixReattach 用
}
