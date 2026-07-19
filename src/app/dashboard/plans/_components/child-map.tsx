import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { childIsDone, type ChildBlock } from '../_lib/md-parse';

// program詳細の子計画マップを行UI化（方針3）。✓/○・状態バッジ・次の一手を読み取り専用で表示する。
function stateTone(state: string): string {
  const base = state.replace(/[（(].*$/, '').trim();
  if (base === '完了') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400';
  if (base.startsWith('人間確認')) return 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400';
  if (base.startsWith('実装') || base.startsWith('レビュー') || base.startsWith('修正')) return 'border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400';
  return 'border-border bg-muted text-muted-foreground';
}

export function ChildMap({ blocks }: { blocks: ChildBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <ul className="space-y-2">
      {blocks.map((block) => {
        const done = childIsDone(block);
        const nextStep = block.fields['次'];
        return (
          <li key={block.nn} className="rounded-md border border-border/60 px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 w-5 shrink-0 text-center" aria-hidden>
                {done ? <span className="font-bold text-emerald-600">✓</span> : <span className="text-muted-foreground/50">○</span>}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold tabular-nums text-muted-foreground">{block.nn}</span>
                  <span className={cn('text-sm font-semibold break-words', done && 'text-muted-foreground')}>{block.title}</span>
                </div>
                {block.state ? (
                  <Badge variant="outline" className={cn('font-medium', stateTone(block.state))}>
                    {block.state}
                  </Badge>
                ) : null}
                {nextStep ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">次:</span> {nextStep}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
