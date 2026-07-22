'use client';

import { useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { carryOverAction, completeHeadingAction, undoCompleteAction } from '../actions';

// 修正01: 完了 / undo / 明日へ引き継ぎ の楽観的UI（AGENTS.md「ユーザー操作は原則として楽観的UIに／
// 保存中は低透明度等で反映済みと分かる状態に／失敗時だけ元へ戻し操作場所の近くにエラー」）。
// 押した瞬間に useTransition の isPending で反映（チェック充填 / 空 / 淡色化）し、startTransition 内でサーバー処理を実行→
// 失敗時のみ catch で元状態へ戻しエラーを近くに出す。サーバー側は boardRedirect を廃し revalidatePath のみ
// （往復 navigation コストを削る）。complete ↔ undo は同じチェックの見た目で往復する。

function buildFormData(todoId: string, date: string): FormData {
  const fd = new FormData();
  fd.set('id', todoId);
  fd.set('date', date);
  return fd;
}

// 44px タップターゲット内の見た目チェック（完了 / undo 共通）。filled=完了見た目（緑✓）／空=未完了見た目（枠）。
function CheckSquare({ filled, invite }: { filled: boolean; invite: boolean }) {
  return (
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
}

const TAP_CENTER = '-ml-1.5 inline-grid h-11 w-11 shrink-0 place-items-center rounded-xl active:scale-95';
const TAP_TOP = '-ml-1.5 -mt-1.5 inline-grid h-11 w-11 shrink-0 place-items-center rounded-xl active:scale-95';

// 完了（レビュー完了）: 空チェック→タップで充填（楽観）→completeHeadingAction。成功時は todo が
// 「終わったこと」へ移り本コンポーネントは unmount。失敗時のみ空へ戻しエラーを出す。
// stayOpen=true は工程表だけの表示用チェック。親todoを完了にせず、開いた詳細内でチェックを保持する。
// label を渡すと工程表（plan-steps）用の行（チェック＋説明）として描画する。無ければチェック単体（theme-card）。
export function CompleteHeadingButton({
  todoId,
  date,
  title,
  label,
  stayOpen = false,
}: {
  todoId: string;
  date: string;
  title: string;
  label?: string;
  stayOpen?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const run = () => {
    if (stayOpen) {
      setIsChecked(true);
      return;
    }

    setFailed(false);
    startTransition(async () => {
      try {
        await completeHeadingAction(buildFormData(todoId, date));
      } catch {
        setFailed(true);
      }
    });
  };
  // stayOpen時はDB保存をせず、表示中の工程詳細だけでチェックを保持する。
  // 通常時は楽観: 保存中は充填（＝反映済み）＋淡色（＝保存中）。失敗時のみ空へ戻る。
  const button = (tap: string) => (
    <button
      type="button"
      onClick={run}
      disabled={isPending || (stayOpen && isChecked)}
      aria-label={stayOpen ? `${title}のレビュー完了を確認済みにする` : `${title}をレビューして完了にする`}
      aria-pressed={stayOpen ? isChecked : undefined}
      className={cn(tap, isPending && 'opacity-60')}
    >
      <CheckSquare filled={stayOpen ? isChecked : isPending} invite />
    </button>
  );

  if (label) {
    return (
      <div className="mt-2 flex items-center gap-1">
        {button(TAP_CENTER)}
        <span className="text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400">
          {stayOpen && isChecked
            ? 'レビュー完了を確認しました'
            : isPending
              ? '完了にしています…'
              : failed
                ? '完了にできませんでした。もう一度お試しください。'
                : label}
        </span>
      </div>
    );
  }

  return (
    <span className="relative inline-flex shrink-0">
      {button(TAP_TOP)}
      {failed ? (
        <span
          role="alert"
          className="absolute left-0 top-full z-10 whitespace-nowrap rounded bg-destructive px-1.5 py-0.5 text-[9px] font-semibold text-destructive-foreground shadow"
        >
          完了にできませんでした
        </span>
      ) : null}
    </span>
  );
}

// undo（完了→未完了）: 緑✓→タップで空（楽観・戻し中）→undoCompleteAction。成功時は todo が工程表示へ戻り
// 本コンポーネントは unmount。失敗時のみ✓へ戻しエラーを出す。complete 側と同じチェックの見た目で往復する。
export function UndoHeadingButton({ todoId, date, title }: { todoId: string; date: string; title: string }) {
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const run = () => {
    setFailed(false);
    startTransition(async () => {
      try {
        await undoCompleteAction(buildFormData(todoId, date));
      } catch {
        setFailed(true);
      }
    });
  };
  // 楽観: 保存中は空（＝未完了へ戻す反映）＋淡色。失敗時のみ✓へ戻る。
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        aria-label={`${title}を未完了に戻す`}
        className={cn(TAP_CENTER, isPending && 'opacity-60')}
      >
        <CheckSquare filled={!isPending} invite={false} />
      </button>
      {failed ? (
        <span
          role="alert"
          className="absolute left-0 top-full z-10 whitespace-nowrap rounded bg-destructive px-1.5 py-0.5 text-[9px] font-semibold text-destructive-foreground shadow"
        >
          戻せませんでした
        </span>
      ) : null}
    </span>
  );
}

// 明日へ引き継ぐ: タップで淡色＋「引き継ぎ中…」（楽観）→carryOverAction。成功時は todo が翌日へ移り unmount。
// 失敗時のみ元へ戻しエラーを出す。className で親のインデント（theme-card は INDENT・plan-steps は無し）を渡す。
export function CarryOverButton({
  todoId,
  date,
  title,
  className,
}: {
  todoId: string;
  date: string;
  title: string;
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const run = () => {
    setFailed(false);
    startTransition(async () => {
      try {
        await carryOverAction(buildFormData(todoId, date));
      } catch {
        setFailed(true);
      }
    });
  };
  return (
    <div className={cn('mt-2', className)}>
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        aria-label={`${title}を明日へ引き継ぐ`}
        className={cn(
          'min-h-8 rounded-lg border border-border bg-background px-2.5 text-[11.5px] font-semibold text-muted-foreground active:scale-[0.99]',
          isPending && 'opacity-50',
        )}
      >
        {isPending ? '引き継ぎ中…' : '明日へ引き継ぐ'}
      </button>
      {failed ? (
        <span role="alert" className="ml-2 text-[10px] text-destructive">
          引き継げませんでした。もう一度お試しください。
        </span>
      ) : null}
    </div>
  );
}
