'use client';

import { useState } from 'react';
import { ChevronRight, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Todo } from '@/lib/turso/todos';
import type { TodoStep } from '@/lib/turso/todo-steps';
import type { SessionSubagent } from '@/lib/turso/session-subagents';
import { CarryOverButton, CompleteHeadingButton } from '@/app/dashboard/board/_components/optimistic-controls';
import { FixReattach } from '@/app/dashboard/board/_components/fix-reattach';
import { QuestionAnswer } from '@/app/dashboard/board/_components/question-answer';
import { FileAgentCheck } from '@/app/dashboard/board/_components/file-agent-check';
import { StepDocButton } from './step-doc-button';
import { LiveElapsed } from './live-elapsed';
import type { SessionItem, TaskItem } from './types';

// 子06「3段階ドリルダウン v6」: 計画カード（PlanCardV2）を開いた段階2/3で出す指揮官バー・番号付き工程・AIレーン。
// 正本モック: ~/Private/personal-os/my-brain/areas/ai運用/plans/active/2026-07-21-ボードUI計画統合/references/board-mock-v6.html
// - 段階2: 指揮官バー＋番号工程（工程は経過を出さず1行・番号バッジは色のみ）。点滅は右端「実装中」ピルだけ。
// - 段階3: 工程タップでその直下にAIレーン（サブの種別/モデル/送った指示/リアルタイム経過）が展開。
// 質問回答・2層チェック・手直し付け替え・明日へ引き継ぐ・FileAgentCheck は既存機能を維持する。

// planSlug から base と NN子番号を分ける（`slug#03` → base='slug', nn='03'）。
function splitPlanSlug(planSlug: string): { base: string; nn: string } {
  const hash = planSlug.indexOf('#');
  if (hash < 0) return { base: planSlug, nn: '' };
  return { base: planSlug.slice(0, hash), nn: planSlug.slice(hash + 1) };
}

// 工程番号バッジの表示状態（色のみ）: done=薄緑・doing=緑・waiting=琥珀・todo/skipped=グレー。
// 「確認待ち」はサブには立たない（指揮官が処理）。工程が waiting になるのは、その工程を実行中の todo に
// 未回答の質問がある（＝人間ゲート待ち）時だけ。
type StepView = 'done' | 'skipped' | 'doing' | 'waiting' | 'todo';
function stepView(step: TodoStep, hasOpenQuestion: boolean): StepView {
  if (step.status === 'done') return 'done';
  if (step.status === 'skipped') return 'skipped';
  if (step.status === 'doing') return hasOpenQuestion ? 'waiting' : 'doing';
  return 'todo';
}

const BADGE_CLASS: Record<StepView, string> = {
  done: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  doing: 'border-emerald-600 bg-emerald-600 text-white',
  waiting: 'border-amber-500 bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  todo: 'border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-transparent dark:text-slate-500',
  skipped: 'border-slate-300 bg-slate-100 text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500',
};

function launchViaLabel(via: string): string {
  switch (via) {
    case 'agent-tool':
      return '指揮官が派遣';
    case 'exec':
      return '直接exec';
    case 'headless':
      return '定期実行';
    default:
      return via;
  }
}

function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > 64 ? `${line.slice(0, 64)}…` : line;
}

// 指揮官バー（プログラム/テーマ層に1本・工程レーンには出さない）: 全体監督のメインセッション。
// 識別＝そのカードの計画に紐づくセッションのうち、稼働(run/sub)を優先し、無ければ確認待ち(wait)を1本。
// 琥珀の「確認待ち」はこの指揮官バー（または独立メインセッション）だけに立つ。
export function CommanderBar({
  item,
  planTitle,
  selectedDate,
}: {
  item: SessionItem;
  planTitle: string;
  selectedDate: string;
}) {
  const s = item.session;
  const live = s.state === 'run' || s.state === 'sub';
  const wait = s.state === 'wait';
  const runtimeModel = [s.type, s.model].filter(Boolean).join('·') || 'メインセッション';
  const shortKey = s.sessionKey.replace(/^s:/, '').slice(0, 8);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50/70 px-2.5 py-1.5 dark:border-blue-500/40 dark:bg-blue-500/10">
      <span
        className={cn('h-2 w-2 shrink-0 rounded-full', wait ? 'bg-amber-500' : live ? 'bg-emerald-500' : 'bg-muted-foreground')}
        aria-hidden
      />
      <span className="shrink-0 text-[11px] font-bold text-blue-800 dark:text-blue-200">指揮官</span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
        {runtimeModel}｜s:{shortKey}
      </span>
      {wait ? (
        <span className="shrink-0 text-[9.5px] font-bold text-amber-700 dark:text-amber-400">確認待ち</span>
      ) : null}
      <span className="shrink-0 text-[9px] font-bold text-blue-700 dark:text-blue-300">全体監督・サブ派遣</span>
      <div className="shrink-0">
        <FileAgentCheck sessionKey={s.sessionKey} todoTitle={s.goal || planTitle} date={selectedDate} label="指揮官" />
      </div>
    </div>
  );
}

// 質問中のAI todoの行内質問文＋回答UI（theme-card の QuestionBlock と同じ配線を維持）。
function TaskQuestion({ todo, selectedDate }: { todo: Todo; selectedDate: string }) {
  if (!todo.question) return null;
  return (
    <div className="mb-2">
      <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <span className="min-w-0">{todo.question}</span>
      </p>
      <div className="mt-2">
        {todo.questionGate ? (
          <p className="text-xs text-muted-foreground">
            これは承認が要る操作です。ボードからは回答できません。セッションで明示承認してください。
          </p>
        ) : (
          <QuestionAnswer todoId={todo.id} choices={todo.questionChoices} allowFree={todo.questionAllowFree} date={selectedDate} />
        )}
      </div>
    </div>
  );
}

// サブAIチップ（段階3）: 種別・モデル・起動経路・リアルタイム経過＋送った指示（1行要約→タップで全文）。
// サブに「確認待ち」は出さない（指揮官が処理）。点滅もさせない（点滅は工程の「実装中」ピルのみ）。
function SubChip({ sub }: { sub: SessionSubagent }) {
  const running = sub.status === 'running';
  const who = sub.agentType || sub.label || '(無題のサブ作業)';
  const meta = [sub.model || sub.runtime, launchViaLabel(sub.launchVia)].filter(Boolean).join('｜');
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background px-2 py-1">
      <div className="flex items-center gap-2">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', running ? 'bg-emerald-500' : 'bg-muted-foreground')} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold">サブ: {who}</span>
        {meta ? <span className="shrink-0 truncate text-[9.5px] text-muted-foreground">{meta}</span> : null}
        <span className="shrink-0 text-[9.5px] tabular-nums text-muted-foreground">
          {running && sub.startedAt ? <LiveElapsed startedAt={sub.startedAt} /> : sub.elapsedMin > 0 ? `${sub.elapsedMin}分` : ''}
        </span>
      </div>
      {sub.prompt ? (
        <details className="rounded-md border border-border/70 bg-muted/30 px-1.5 py-1">
          <summary className="cursor-pointer list-none truncate text-[9.5px] text-muted-foreground [&::-webkit-details-marker]:hidden">
            <span className="font-semibold text-foreground/70">送った指示:</span> {firstLine(sub.prompt)}
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[9.5px] leading-relaxed text-foreground/80">
            {sub.prompt}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

// 独立メインセッション（指揮官以外）: 確認待ちが立ちうる主体。FileAgentCheck（人間チェック）を維持する。
function MainSessionMini({ item, todoTitle, selectedDate }: { item: SessionItem; todoTitle: string; selectedDate: string }) {
  const s = item.session;
  const live = s.state === 'run' || s.state === 'sub';
  const wait = s.state === 'wait';
  const name = s.goal || s.now || 'メインセッション';
  const runtimeModel = [s.type, s.model].filter(Boolean).join('·');
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1">
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', wait ? 'bg-amber-500' : live ? 'bg-emerald-500' : 'bg-muted-foreground')}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold">メイン: {name}</span>
      {runtimeModel ? <span className="shrink-0 text-[9.5px] text-muted-foreground">{runtimeModel}</span> : null}
      {wait ? <span className="shrink-0 text-[9px] font-bold text-amber-700 dark:text-amber-400">確認待ち</span> : null}
      <FileAgentCheck sessionKey={s.sessionKey} todoTitle={todoTitle || name} date={selectedDate} label={name} />
    </div>
  );
}

// 段階3: 工程直下のAIレーン。独立メインセッション＋サブAIチップを出す。空でも沈黙させず理由を示す。
function AiLane({ task, selectedDate, commanderKey }: { task: TaskItem; selectedDate: string; commanderKey: string }) {
  const { sessions, todo } = task;
  const subs = sessions.flatMap((si) => si.subagents);
  const independentMains = sessions.filter((si) => si.session.sessionKey !== commanderKey);
  const empty = subs.length === 0 && independentMains.length === 0;
  return (
    <div className="ml-[18px] mt-1 flex flex-col gap-1.5 border-l-2 border-blue-200 pl-2.5 dark:border-blue-500/30">
      {independentMains.map((si) => (
        <MainSessionMini key={si.session.sessionKey} item={si} todoTitle={todo.title} selectedDate={selectedDate} />
      ))}
      {subs.map((sub) => (
        <SubChip key={`${sub.sessionKey}-${sub.subSeq}`} sub={sub} />
      ))}
      {empty ? <p className="text-[10.5px] text-muted-foreground">この工程のサブAIはまだいません。</p> : null}
    </div>
  );
}

// 番号付き工程の1行（段階2）。番号バッジ＝色のみ、右端に「実装中」/「確認待ち」ピル、📄ビューア。
// AIレーンを持つ工程（実行中＝aiStep）はタップで段階3を展開する。
function StepRow({
  step,
  view,
  slug,
  nn,
  expandable,
  task,
  selectedDate,
  commanderKey,
}: {
  step: TodoStep;
  view: StepView;
  slug: string;
  nn: string;
  expandable: boolean;
  task: TaskItem;
  selectedDate: string;
  commanderKey: string;
}) {
  const [open, setOpen] = useState(false);
  const badge = String(step.seq).padStart(2, '0');
  const docKind = step.kind === 'review' ? 'review' : step.kind === 'fix' ? 'fix' : 'step';

  const badgeEl = (
    <span
      className={cn(
        'grid h-4 min-w-[22px] shrink-0 place-items-center rounded-[5px] border px-1 text-[9px] font-extrabold tabular-nums',
        BADGE_CLASS[view],
      )}
    >
      {badge}
    </span>
  );

  const labelEl = (
    <span
      className={cn(
        'min-w-0 flex-1 break-words text-[12px] leading-snug',
        view === 'done' && 'text-muted-foreground line-through',
        view === 'skipped' && 'text-muted-foreground line-through opacity-70',
        view === 'doing' && 'font-bold',
        view === 'waiting' && 'font-bold text-amber-700 dark:text-amber-400',
        view === 'todo' && 'text-muted-foreground',
      )}
    >
      {step.title}
      {step.kind === 'review' ? (
        <span className="ml-1 rounded bg-amber-100 px-1.5 py-px align-middle text-[9px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          まとめ
        </span>
      ) : null}
      {step.kind === 'fix' ? (
        <span className="ml-1 rounded bg-rose-100 px-1.5 py-px align-middle text-[9px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          手直し
        </span>
      ) : null}
    </span>
  );

  const pill =
    view === 'doing' ? (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500 bg-emerald-50 px-2 py-0.5 text-[9.5px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" aria-hidden />
        実装中
      </span>
    ) : view === 'waiting' ? (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500 bg-amber-100 px-2 py-0.5 text-[9.5px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
        確認待ち
      </span>
    ) : null;

  return (
    <li>
      <div className="flex items-center gap-1.5 py-0.5">
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${step.title}のAIレーンを${open ? '閉じる' : '開く'}`}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
            {badgeEl}
            {labelEl}
          </button>
        ) : (
          <div className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5">
            <span className="w-3 shrink-0" aria-hidden />
            {badgeEl}
            {labelEl}
          </div>
        )}
        <StepDocButton slug={slug} nn={nn} kind={docKind} ariaLabel={`${step.title}の計画文書を開く`} />
        {pill}
      </div>
      {expandable && open ? <AiLane task={task} selectedDate={selectedDate} commanderKey={commanderKey} /> : null}
    </li>
  );
}

// 計画カード内のAI todo 1件分の工程ブロック（段階2の工程リスト＋段階3のAIレーン＋既存の操作系）。
export function PlanTaskSteps({
  task,
  selectedDate,
  aiTargets,
  commanderKey,
}: {
  task: TaskItem;
  selectedDate: string;
  aiTargets: { id: string; title: string }[];
  commanderKey: string;
}) {
  const { todo, steps, sessions } = task;
  const hasOpenQuestion = Boolean(todo.question) && !todo.answer;
  const { base, nn } = splitPlanSlug(task.planSlug);
  const fixSteps = steps.filter((s) => s.kind === 'fix');
  const fixTargets = aiTargets.filter((t) => t.id !== todo.id);
  const total = steps.length;
  const allDone = total > 0 && steps.every((s) => s.status === 'done' || s.status === 'skipped');

  // AIレーンを載せる工程 = 実行中(doing)。無ければ、稼働セッションがある時に最初の未完了工程へ（沈黙させない）。
  const doingIdx = steps.findIndex((s) => s.status === 'doing');
  const fallbackIdx = steps.findIndex((s) => s.status === 'todo');
  const aiStepIdx =
    doingIdx >= 0 ? doingIdx : sessions.length > 0 ? (fallbackIdx >= 0 ? fallbackIdx : total - 1) : -1;

  return (
    <div className="pt-2.5">
      {hasOpenQuestion ? <TaskQuestion todo={todo} selectedDate={selectedDate} /> : null}

      {todo.answer && !todo.answerConsumedAt ? (
        <p className="mb-1 text-[11px] text-muted-foreground">回答済（未消費）: {todo.answer}</p>
      ) : null}

      {total > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              view={stepView(step, hasOpenQuestion)}
              slug={base}
              nn={nn}
              expandable={index === aiStepIdx}
              task={task}
              selectedDate={selectedDate}
              commanderKey={commanderKey}
            />
          ))}
        </ul>
      ) : (
        <p className="text-[11.5px] text-muted-foreground">工程未登録（計画待ち）</p>
      )}

      {/* 2層チェック: 全工程完了で見出しをレビュー完了にできる（既存 completeHeadingAction を楽観的UI化・修正01） */}
      {allDone ? (
        <CompleteHeadingButton
          todoId={todo.id}
          date={selectedDate}
          title={todo.title}
          label="全工程完了 — チェックでレビュー完了にできます"
        />
      ) : null}

      {/* 手直し付け替え（既存 FixReattach を維持） */}
      {fixSteps.length > 0 && fixTargets.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {fixSteps.map((step) => (
            <FixReattach key={step.id} stepId={step.id} date={selectedDate} targets={fixTargets} />
          ))}
        </div>
      ) : null}

      {/* 明日へ引き継ぐ（既存 carryOverAction を楽観的UI化・修正01） */}
      <CarryOverButton todoId={todo.id} date={selectedDate} title={todo.title} />
    </div>
  );
}
