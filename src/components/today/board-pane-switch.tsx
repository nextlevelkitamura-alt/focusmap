import Link from 'next/link';
import { Bot, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Todoタブ内の「予定（カレンダー）⇄ AIボード」切替ピル。
 * どちらの画面でも同じ見た目・同じ位置に出し、タップでルートを行き来する。
 * Server/Client両対応にするためLinkのみで構成する（状態を持たない）。
 */
export function BoardPaneSwitch({ active, className }: { active: 'schedule' | 'board'; className?: string }) {
  const base =
    'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[12.5px] font-bold transition-colors';
  return (
    <div
      className={cn(
        'inline-flex w-full items-center gap-0.5 rounded-xl border border-white/15 bg-white/[0.055] p-0.5',
        className,
      )}
      role="tablist"
      aria-label="予定とAIボードの切替"
    >
      <Link
        href="/dashboard"
        role="tab"
        aria-selected={active === 'schedule'}
        className={cn(base, active === 'schedule' ? 'bg-black text-neutral-50 shadow-sm' : 'text-neutral-400 active:bg-white/[0.07]')}
      >
        <CalendarDays className="h-3.5 w-3.5" />
        予定
      </Link>
      <Link
        href="/dashboard/board"
        role="tab"
        aria-selected={active === 'board'}
        className={cn(base, active === 'board' ? 'bg-black text-neutral-50 shadow-sm' : 'text-neutral-400 active:bg-white/[0.07]')}
      >
        <Bot className="h-3.5 w-3.5" />
        AIボード
      </Link>
    </div>
  );
}
