'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, GripVertical, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Todo } from '@/lib/turso/todos';
import type { TodoStep, TodoStepAggregate, TodoTimes } from '@/lib/turso/todo-steps';
import { deriveBoardStatus, boardStatusClassName, type BoardStatus } from '@/lib/board-status';
import { toggleTodoAction } from '@/app/dashboard/board/actions';
import {
  CarryOverButton,
  CompleteHeadingButton,
  UndoHeadingButton,
} from '@/app/dashboard/board/_components/optimistic-controls';
import { FixReattach } from '@/app/dashboard/board/_components/fix-reattach';
import { QuestionAnswer } from '@/app/dashboard/board/_components/question-answer';
import { SessionRow } from './session-row';
import { CommanderBar, PlanTaskSteps } from './plan-steps';
import type { PlanCardData, TaskItem, FinishedTodoItem, SessionItem } from './types';

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

  // レビュー待ちAI見出しの完了は楽観的UI（修正01・CompleteHeadingButton）。押下即時にチェック充填→完了。
  return <CompleteHeadingButton todoId={todo.id} date={selectedDate} title={todo.title} />;
}

// 未完了タスクの「明日へ引き継ぐ」1タップ（既存 carryOverAction を楽観的UI化・修正01。INDENT でチェック幅に揃える）。
function CarryButton({ todoId, title, selectedDate }: { todoId: string; title: string; selectedDate: string }) {
  return <CarryOverButton todoId={todoId} date={selectedDate} title={title} className={INDENT} />;
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

// 質問中のAI todoの行内質問文＋回答UI（見出しあり/なしの両行から使う。「きみの番」レーンは修正02で廃止・行内へ移設）。
function QuestionBlock({ todo, selectedDate }: { todo: Todo; selectedDate: string }) {
  if (!todo.question) return null;
  return (
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
  );
}

// AIタスク行の下部共通ブロック（進捗バー・回答・工程・レビュー完了・手直し・繰越し・セッション行）。
// reviewCheck=true は見出しなし行（子05・plan_slug付き）で、レビュー完了チェックを「全ステップ完了」行へ移設する
// （2層チェックの配線維持。見出しあり行は従来どおり左のチェック丸で完了する）。
function AiTaskTail({
  task,
  status,
  selectedDate,
  aiTargets,
  reviewCheck,
}: {
  task: TaskItem;
  status: BoardStatus;
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
  reviewCheck: boolean;
}) {
  const { todo, steps, agg, sessions } = task;
  const pct = agg?.pct ?? null;
  const fixSteps = steps.filter((step) => step.kind === 'fix');
  const fixTargets = aiTargets.filter((target) => target.id !== todo.id);
  return (
    <>
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
        reviewCheck ? (
          <div className={cn('mt-2 flex items-center gap-1', INDENT)}>
            <TaskCheck todo={todo} reviewReady selectedDate={selectedDate} />
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              全ステップ完了 — チェックでレビュー完了にできます
            </p>
          </div>
        ) : (
          <p className={cn('mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400', INDENT)}>
            全ステップ完了 — 左のチェックでレビュー完了にできます
          </p>
        )
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
    </>
  );
}

// レールのタスク行（既存 TaskCard 流用・改造）。行の直下に task.sessions を SessionRow でぶら下げる。
// 質問中のAI todoはこの行内に質問文と回答UI(QuestionAnswer)を出す（「きみの番」レーンは修正02で廃止・行内へ移設）。
// 子05: plan_slug付きAI todoはタスク見出し行（タイトル・チェック丸）を描画しない（カード見出し＝計画名と
// タイトル二重になるため）。メタ1行＋工程タイムラインをカード直下に直接出す。plan_slugなしは従来どおり。
function TaskRow({
  task,
  aiTargets,
  selectedDate,
}: {
  task: TaskItem;
  aiTargets: { id: string; title: string }[];
  selectedDate: string;
}) {
  const { todo, agg, times, sessions, repoName } = task;

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

  // 見出しなし行（子05）: タイトル・チェック丸を出さず、メタ1行（状態・%・計画チップ・累計時間）＋
  // 質問回答＋工程タイムラインを直接出す。レビュー完了チェックは AiTaskTail 内の「全ステップ完了」行へ移設。
  if (task.planSlug) {
    return (
      <div className="pt-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
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
            {status.tone === 'question' ? <QuestionBlock todo={todo} selectedDate={selectedDate} /> : null}
          </div>
          {times ? <TaskTimes times={times} running={status.tone === 'run'} /> : null}
        </div>
        <AiTaskTail task={task} status={status} selectedDate={selectedDate} aiTargets={aiTargets} reviewCheck />
      </div>
    );
  }

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
          {status.tone === 'question' ? <QuestionBlock todo={todo} selectedDate={selectedDate} /> : null}
        </div>
        {times ? <TaskTimes times={times} running={status.tone === 'run'} /> : null}
      </div>
      <AiTaskTail task={task} status={status} selectedDate={selectedDate} aiTargets={aiTargets} reviewCheck={false} />
    </div>
  );
}

// 「終わったこと」折りたたみ（モックv2 details.fin 準拠・既定open）。完了AI todo と session_logs をまとめて出す。
// 修正01: 完了AI todo の先頭✓を「タップで未完了へ戻す」可逆トグル（UndoHeadingButton）にする（完了→縮小で戻せない問題の解消）。
// session_logs は取り消し対象の todo が無いため静的✓のまま。
function FinishedFold({
  todos,
  logs,
  selectedDate,
}: {
  todos: FinishedTodoItem[];
  logs: { entry: string; count: number }[];
  selectedDate: string;
}) {
  const count = todos.length + logs.length;
  if (count === 0) return null;
  return (
    <details open className="mt-2 border-t border-border/60 pt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[12.5px] text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span className="text-[9px] transition-transform [details[open]_&]:rotate-90">▶</span>
        終わったこと {count}件
      </summary>
      <div className="space-y-1 pl-4 pt-1">
        {todos.map((f) => (
          <div key={f.todo.id} className="flex min-h-11 items-center gap-1 text-[11.5px] text-slate-600 dark:text-slate-300">
            <UndoHeadingButton todoId={f.todo.id} date={selectedDate} title={f.todo.title} />
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

function agentLabel(item: SessionItem) {
  const session = item.session;
  const source = `${session.type} ${session.model}`.toLowerCase();
  if (source.includes('claude') || source.includes('anthropic') || source.includes('opus') || source.includes('sonnet')) return 'Claude';
  if (source.includes('codex') || source.includes('openai') || source.includes('gpt')) return 'Codex';
  if (source.includes('gemini')) return 'Gemini';
  return session.type || session.model || 'AI';
}

function PlanActivityPreview({ sessions }: { sessions: SessionItem[] }) {
  const visible = sessions.slice(0, 2);
  if (visible.length === 0) return null;

  return (
    <div className="mt-2 divide-y divide-border/50 rounded-lg border border-border/60 bg-background/65 px-2.5">
      {visible.map((item) => {
        const session = item.session;
        const live = session.state === 'run' || session.state === 'sub';
        const wait = session.state === 'wait';
        return (
          <div key={session.sessionKey} className="flex min-h-9 items-center gap-2 py-1.5 text-[11px]">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', wait ? 'bg-amber-500' : live ? 'bg-emerald-500' : 'bg-muted-foreground')} aria-hidden />
            <span className="w-14 shrink-0 font-semibold">{agentLabel(item)}</span>
            <span className={cn('w-14 shrink-0 font-semibold', wait ? 'text-amber-700 dark:text-amber-300' : live ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>
              {wait ? '確認待ち' : live ? '稼働中' : '停止'}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{session.now || session.goal || '作業内容を取得中'}</span>
          </div>
        );
      })}
      {sessions.length > visible.length ? (
        <p className="py-1.5 text-right text-[10px] text-muted-foreground">ほか {sessions.length - visible.length} 件</p>
      ) : null}
    </div>
  );
}

function PreviewPlanTimeline({ data }: { data: PlanCardData }) {
  const steps = data.tasks.flatMap((task) => task.steps);
  return (
    <div className="space-y-2">
      <p className="rounded-lg border border-blue-200 bg-blue-50/70 px-2.5 py-2 text-[10.5px] text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
        表示確認用サンプルです。ここでは工程の見え方だけを表示し、完了・回答・保存操作は行いません。
      </p>
      {steps.length > 0 ? (
        <ol className="relative space-y-0.5 pl-1">
          {steps.map((step, index) => {
            const done = step.status === 'done';
            const doing = step.status === 'doing';
            return (
              <li key={step.id} className="relative flex min-h-9 items-start gap-2.5 text-[11px]">
                {index < steps.length - 1 ? (
                  <span className="absolute bottom-[-3px] left-[7px] top-[17px] w-px bg-border" aria-hidden />
                ) : null}
                <span
                  className={cn(
                    'relative z-[1] mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] font-bold',
                    done
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : doing
                        ? 'border-blue-500 bg-blue-500 text-white'
                        : 'border-border bg-background text-muted-foreground',
                  )}
                >
                  {done ? '✓' : index + 1}
                </span>
                <span className={cn('min-w-0 flex-1 pt-0.5', done && 'text-muted-foreground line-through')}>
                  {step.title}
                </span>
                {doing ? (
                  <span className="shrink-0 rounded-md bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                    実装中 · Codex
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-[11px] text-muted-foreground">工程はまだ登録されていません。</p>
      )}
      {data.finishedLogs.length > 0 ? (
        <div className="border-t border-border/60 pt-2">
          <p className="mb-1 text-[10.5px] font-semibold text-muted-foreground">終わったこと</p>
          {data.finishedLogs.map((log, index) => (
            <p key={`${log.entry}-${index}`} className="text-[11px] text-muted-foreground">
              <span className="mr-1.5 font-bold text-emerald-600">✓</span>
              {log.entry}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// V5 計画カード: 進捗とAIの現在状態を同じカードへ統合する。
// 工程時系列は従来どおり初期非表示で、「工程を見る」からだけ展開する。
export function PlanCardV2({
  data,
  selectedDate,
  aiTargets,
  onPreviewOnlyAction,
  isPreview = false,
}: {
  data: PlanCardData;
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
  onPreviewOnlyAction?: (action: string) => void;
  isPreview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { planSlug, planTitle, planResolved, bucket, stepProgress, progress, tasks, cardSessions, finishedTodos, finishedLogs, liveCount, waitCount } = data;
  const isThemeOnly = planSlug === '';
  // 済/総: 計画カード=plan_slug一致のtodo_steps集計（子05・SQL導出）／テーマのみカード=従来の当日todo集計。
  const pct = isThemeOnly ? (progress?.pct ?? null) : (stepProgress?.pct ?? null);
  const doneCount = isThemeOnly ? (progress?.done ?? finishedTodos.length) : (stepProgress?.done ?? 0);
  const totalCount = isThemeOnly ? (progress?.total ?? tasks.length + finishedTodos.length) : (stepProgress?.total ?? 0);
  const hasActivity = tasks.length > 0 || cardSessions.length > 0 || finishedTodos.length > 0 || finishedLogs.length > 0;
  const detailHref = !isPreview && !isThemeOnly && planResolved ? `/dashboard/plans/${encodeURIComponent(planSlug)}` : null;
  const lifecycle = isThemeOnly ? 'theme' : bucket || 'linked';

  // 指揮官の識別（子06・v6）: そのカードの計画に紐づくセッションのうち、稼働(run/sub)を優先し、無ければ確認待ち(wait)を1本。
  // = todo_stepsを実行中に打刻しているメインセッション（session.todoId で task へ振り分け済み）。過剰に複雑化しない。
  const allSessions = [...tasks.flatMap((task) => task.sessions), ...cardSessions];
  const commander =
    allSessions.find((s) => s.session.state === 'run' || s.session.state === 'sub') ??
    allSessions.find((s) => s.session.state === 'wait') ??
    allSessions[0] ??
    null;
  const commanderKey = commander?.session.sessionKey ?? '';
  const repoName = tasks.find((task) => task.repoName)?.repoName || allSessions.find((item) => item.session.repo)?.session.repo || '';

  return (
    <article className={cn('overflow-hidden rounded-xl border bg-card', hasActivity ? 'border-border' : 'border-border/70 bg-card/60')}>
      <div className="p-3">
        <div className="flex items-start gap-2">
          {onPreviewOnlyAction ? (
            <button
              type="button"
              onClick={() => onPreviewOnlyAction('Planのドラッグ・Theme間移動')}
              aria-label={`計画 ${planTitle} をドラッグして移動`}
              className="-ml-1 -mt-1 inline-grid h-11 w-8 shrink-0 cursor-grab place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 break-words text-[14px] font-bold leading-snug">{planTitle}</h3>
              <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[9.5px] font-bold', lifecycle === 'active' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : lifecycle === 'planning' ? 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'border-border text-muted-foreground')}>
                {lifecycle}
              </span>
            </div>
            <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              {repoName ? <span className="rounded-md border border-border/70 px-1.5 py-0.5">{repoName}</span> : null}
              {liveCount > 0 ? <span>● 稼働 {liveCount}</span> : null}
              {waitCount > 0 ? <span className="text-amber-700 dark:text-amber-300">● 確認 {waitCount}</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-end justify-between gap-2 tabular-nums">
          <span className={cn('text-2xl font-semibold tracking-tight', pct === null && 'text-muted-foreground')} aria-label={pct === null ? '進捗未集計' : `完了${pct}パーセント`}>
            {pct === null ? '—' : `${pct}%`}
          </span>
          <span className="text-[11px] text-muted-foreground">済 {doneCount}/{totalCount}</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', pct !== null && pct >= 100 ? 'bg-emerald-500' : 'bg-violet-500')}
            style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
          />
        </div>

        <PlanActivityPreview sessions={allSessions} />
        {!hasActivity ? <p className="mt-2 text-[11px] text-muted-foreground">今日は動きなし</p> : null}

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-1.5">
          {hasActivity || isThemeOnly ? (
            <button
              type="button"
              onClick={() => setOpen((previous) => !previous)}
              aria-expanded={open}
              aria-label={`${planTitle}の工程を${open ? '閉じる' : '見る'}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {open ? '工程を閉じる' : '工程を見る'}
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} aria-hidden />
            </button>
          ) : <span />}
          {detailHref ? (
            <Link
              href={detailHref}
              aria-label={`計画 ${planTitle} の詳細を開く`}
              className="inline-flex min-h-11 items-center rounded-lg px-2 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              計画を開く
            </Link>
          ) : null}
        </div>
      </div>

      {/* 入れ子レール（展開時のみ）= 段階2/3。指揮官バー→番号工程→工程タップでAIレーン（子06・v6） */}
      {open ? (
        <div className="border-t border-border px-3 pb-3 pt-2">
          {isPreview ? (
            <PreviewPlanTimeline data={data} />
          ) : (
            <>
          {/* 指揮官バー（プログラム/テーマ層に1本・工程レーンには出さない） */}
          {!isThemeOnly && commander ? (
            <div className="mb-2">
              <CommanderBar item={commander} planTitle={planTitle} selectedDate={selectedDate} />
            </div>
          ) : null}

          <div className="divide-y divide-border/60">
            {tasks.map((task) =>
              !isThemeOnly && task.todo.assignee === 'ai' ? (
                <PlanTaskSteps
                  key={task.todo.id}
                  task={task}
                  aiTargets={aiTargets}
                  selectedDate={selectedDate}
                  commanderKey={commanderKey}
                />
              ) : (
                <TaskRow key={task.todo.id} task={task} aiTargets={aiTargets} selectedDate={selectedDate} />
              ),
            )}
          </div>

          {/* カード直下のライブ行（todo無所属・テーマ一致） */}
          {cardSessions.length > 0 ? (
            <div className="mt-3 space-y-1">
              {cardSessions.map((s) => (
                <SessionRow key={s.session.sessionKey} item={s} selectedDate={selectedDate} />
              ))}
            </div>
          ) : null}

          <FinishedFold todos={finishedTodos} logs={finishedLogs} selectedDate={selectedDate} />
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}
