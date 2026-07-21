'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Todo } from '@/lib/turso/todos';
import type { TodoStep, TodoStepAggregate, TodoTimes } from '@/lib/turso/todo-steps';
import { deriveBoardStatus, boardStatusClassName } from '@/lib/board-status';
import {
  carryOverAction,
  completeHeadingAction,
  toggleTodoAction,
} from '@/app/dashboard/board/actions';
import { FixReattach } from '@/app/dashboard/board/_components/fix-reattach';
import { QuestionAnswer } from '@/app/dashboard/board/_components/question-answer';
import { ThemeEditor } from '@/app/dashboard/board/_components/theme-editor';
import { SessionRow } from './session-row';
import type { ThemeCardData, TaskItem, FinishedTodoItem } from './types';

// テーマ帯左インデント（縦線ワークフロー・進捗バー・繰越しボタンをチェックボックス幅へ揃える）。
const INDENT = 'ml-[46px]';

// 縦線ワークフロー（既存 StepFlow 流用）: done緑✓＋取り消し線グレー／doing明滅ドット＋「今ここ」／todo白抜き。
// 右に所要（SQL導出値）。明滅は motion-safe 系（prefers-reduced-motion で停止）。モックv2 準拠（修正01・条件1）。
function StepFlow({ steps }: { steps: TodoStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className={cn('relative mt-2 list-none', INDENT)}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const glyph = step.status === 'done' ? '✓' : '';
        const nodeClass =
          step.status === 'done'
            ? 'bg-emerald-700'
            : step.status === 'doing'
              ? 'bg-blue-600 animate-pulse motion-reduce:animate-none'
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
                step.status === 'done' && 'text-slate-400 line-through dark:text-slate-500',
                step.status === 'skipped' && 'line-through opacity-60',
                step.kind === 'fix' && step.status !== 'done' && 'text-amber-700 dark:text-amber-400',
              )}
            >
              {step.kind === 'fix' ? <span className="mr-1">🔧</span> : null}
              {step.title}
              {step.kind === 'fix' ? <span className="ml-1 text-[10px]">手直し</span> : null}
              {step.status === 'doing' ? (
                <span className="ml-1.5 rounded bg-blue-100 px-1 py-px align-middle text-[9px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                  今ここ
                </span>
              ) : null}
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

// タスク見出し右の累計2値（既存 TaskTimes 流用）: 実行N分・確認待ちN分。すべてSQL導出。
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

// 左のチェックボックス（既存 TaskCheck 流用）。self=完了トグル／AIレビュー待ち=見出し完了／AI実行中=静的枠。
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

// 未完了タスクの「明日へ引き継ぐ」1タップ（既存 CarryButton 流用）。
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

// 子02: やること行の計画チップ。解決可（plan_docsにある）→計画詳細へのリンク／解決不能→グレー非リンク（沈黙故障させない）。
function PlanChip({ planSlug, planResolved }: { planSlug: string; planResolved: boolean }) {
  if (!planSlug) return null;
  const base = planSlug.includes('#') ? planSlug.slice(0, planSlug.indexOf('#')) : planSlug;
  const label = `計画 › ${planSlug}`;
  if (planResolved) {
    return (
      <Link
        href={`/dashboard/plans/${encodeURIComponent(base)}`}
        className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-blue-700 active:scale-95 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
      >
        {label}
      </Link>
    );
  }
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
      title="この計画slugは計画ミラーに解決しません（plansyncで確認）"
    >
      {label}（未解決）
    </span>
  );
}

// レールのタスク行（既存 TaskCard 流用・改造）。行の直下に task.sessions を SessionRow でぶら下げる。
// 質問中のAI todoはこの行内に質問文と回答UI(QuestionAnswer)を出す（「きみの番」レーンは修正02で廃止・行内へ移設）。
function TaskRow({
  task,
  aiTargets,
  selectedDate,
}: {
  task: TaskItem;
  aiTargets: { id: string; title: string }[];
  selectedDate: string;
}) {
  const { todo, steps, agg, times, sessions, repoName } = task;

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
              <PlanChip planSlug={task.planSlug} planResolved={task.planResolved} />
              {todo.carriedFrom ? <span className="text-[10.5px] text-muted-foreground">昨日から</span> : null}
            </div>
          </div>
        </div>
        {!isDone ? <CarryButton todoId={todo.id} title={todo.title} selectedDate={selectedDate} /> : null}
        {sessions.length > 0 ? (
          <div className="mt-2 space-y-1">
            {sessions.map((s) => (
              <SessionRow key={s.session.sessionKey} item={s} selectedDate={selectedDate} todoTitle={todo.title} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const status = deriveBoardStatus(todo, agg ?? undefined);
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
              {status.tone === 'question' ? <HelpCircle className="h-3 w-3" /> : null}
              {status.label}
            </Badge>
            {pct !== null ? (
              <span className={cn('text-[11.5px] font-bold tabular-nums', pct >= 100 ? 'text-emerald-600' : 'text-blue-600')}>{pct}%</span>
            ) : null}
            <PlanChip planSlug={task.planSlug} planResolved={task.planResolved} />
            {todo.carriedFrom ? <span className="text-[10.5px] text-muted-foreground">昨日から</span> : null}
          </div>
          {status.tone === 'question' && todo.question ? (
            <div className="mt-2">
              <p className="flex items-start gap-1.5 text-sm leading-relaxed">
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span className="min-w-0">{todo.question}</span>
              </p>
              <div className="mt-2">
                {todo.questionGate ? (
                  <p className="text-xs text-muted-foreground">
                    これは承認が要る操作です。ボードからは回答できません。セッションで明示承認してください。
                  </p>
                ) : (
                  <QuestionAnswer
                    todoId={todo.id}
                    choices={todo.questionChoices}
                    allowFree={todo.questionAllowFree}
                    date={selectedDate}
                  />
                )}
              </div>
            </div>
          ) : null}
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

      {sessions.length > 0 ? (
        <div className="mt-2 space-y-1">
          {sessions.map((s) => (
            <SessionRow key={s.session.sessionKey} item={s} selectedDate={selectedDate} todoTitle={todo.title} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// 「終わったこと」折りたたみ（モックv2 details.fin 準拠・既定open）。完了AI todo と session_logs をまとめて出す。
function FinishedFold({ todos, logs }: { todos: FinishedTodoItem[]; logs: { entry: string; count: number }[] }) {
  const count = todos.length + logs.length;
  if (count === 0) return null;
  return (
    <details open className="mt-2 border-t border-border/60 pt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[12.5px] text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span className="text-[9px] transition-transform [details[open]_&]:rotate-90">▶</span>
        終わったこと {count}件
      </summary>
      <div className="space-y-1.5 pl-4 pt-1">
        {todos.map((f) => (
          <div key={f.todo.id} className="flex items-baseline gap-2 text-[11.5px] text-slate-600 dark:text-slate-300">
            <span className="shrink-0 font-bold text-emerald-600">✓</span>
            <span className="min-w-0 flex-1 break-words">
              {f.todo.title}
              {f.doneSteps > 0 ? <span className="ml-1 text-muted-foreground">（✓ {f.doneSteps}ステップ完了）</span> : null}
            </span>
            {f.runMin ? <span className="shrink-0 text-[10px] tabular-nums text-slate-400">実行{f.runMin}分</span> : null}
          </div>
        ))}
        {logs.map((log, index) => (
          <div key={`log-${index}`} className="flex items-baseline gap-2 text-[11.5px] text-slate-600 dark:text-slate-300">
            <span className="shrink-0 font-bold text-emerald-600">✓</span>
            <span className="min-w-0 flex-1 break-words">{log.entry}</span>
            {log.count > 1 ? <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px]">×{log.count}</span> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

// board-v2 テーマカード（修正02・デフォルト折りたたみ）: 通常状態はヘッダ1行サマリだけ
// （テーマ名・進捗％・稼働N緑点・待機N琥珀点・済/総やること数）。ヘッダタップで展開して初めて
// 細メーター・ライブ帯・計画チップ・入れ子レール（タスク行＋セッション行＋終わったこと折りたたみ）を出す。
// 折りたたみ状態はカード単位の useState（初期値=折りたたみ・永続化しない）。
// テーマの目的・完了条件・計画本文はボードに描画しない（計画はチップ→plans詳細ページの2段導線。修正02・条件3）。
export function ThemeCardV2({
  data,
  selectedDate,
  aiTargets,
}: {
  data: ThemeCardData;
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const { theme, progress, tasks, themeSessions, finishedTodos, finishedLogs, liveCount, waitCount } = data;
  const isUncat = theme === null;
  const pct = progress?.pct ?? null;
  const doneCount = progress?.done ?? finishedTodos.length;
  const totalCount = progress?.total ?? tasks.length + finishedTodos.length;

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* テーマ帯（ヘッダ1行サマリ。タップで展開/折りたたみ） */}
      <div className={cn(isUncat ? 'bg-muted/40' : 'bg-blue-50/60 dark:bg-blue-500/10')}>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-label={`${isUncat ? '未分類' : theme.name}を${open ? '折りたたむ' : '展開する'}`}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
          >
            <ChevronRight
              className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
              aria-hidden
            />
            <h3 className="min-w-0 flex-1 truncate text-[14.5px] font-bold leading-snug">{isUncat ? '未分類' : theme.name}</h3>
            <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
              {!isUncat && pct !== null ? (
                <span
                  className={cn(
                    'text-xs font-extrabold',
                    pct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-700 dark:text-blue-300',
                  )}
                  aria-label={`完了${pct}パーセント`}
                >
                  {pct}%
                </span>
              ) : null}
              {liveCount > 0 ? (
                <span className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400" title="稼働中">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" aria-hidden />
                  {liveCount}
                </span>
              ) : null}
              {waitCount > 0 ? (
                <span className="flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400" title="確認待ち">
                  <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
                  {waitCount}
                </span>
              ) : null}
              <span>済 {doneCount}/{totalCount}</span>
            </span>
          </button>
          {open && !isUncat ? (
            <div className="shrink-0 pr-2">
              <ThemeEditor
                theme={{ id: theme.id, name: theme.name, purpose: theme.purpose, doneCriteria: theme.doneCriteria, goalRef: theme.goalRef }}
                date={selectedDate}
              />
            </div>
          ) : null}
        </div>

        {open ? (
          <div className="px-3 pb-3">
            {/* 細い進捗メーター */}
            {!isUncat && pct !== null ? (
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-blue-500')}
                  style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                />
              </div>
            ) : null}

            {/* ライブ帯 */}
            {liveCount > 0 || waitCount > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground tabular-nums">
                {liveCount > 0 ? (
                  <span className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" />
                    {liveCount}体が作業中
                  </span>
                ) : null}
                {waitCount > 0 ? (
                  <span className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    {waitCount}体が確認待ち
                  </span>
                ) : null}
              </div>
            ) : null}

            {/* 配下計画チップ（計画名のみ。本文はplans詳細ページで見る） */}
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
        ) : null}
      </div>

      {/* 入れ子レール（展開時のみ） */}
      {open ? (
        <div className="border-t border-border px-3 pb-3 pt-1">
          <div className="divide-y divide-border/60">
            {tasks.map((task) => (
              <TaskRow key={task.todo.id} task={task} aiTargets={aiTargets} selectedDate={selectedDate} />
            ))}
          </div>

          {/* テーマ直下のライブ行（todo無所属） */}
          {themeSessions.length > 0 ? (
            <div className="mt-3 space-y-1">
              {themeSessions.map((s) => (
                <SessionRow key={s.session.sessionKey} item={s} selectedDate={selectedDate} />
              ))}
            </div>
          ) : null}

          <FinishedFold todos={finishedTodos} logs={finishedLogs} />
        </div>
      ) : null}
    </article>
  );
}
