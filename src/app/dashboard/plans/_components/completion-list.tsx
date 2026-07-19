import { cn } from '@/lib/utils';
import type { CompletionItem } from '../_lib/md-parse';

// 完了条件のチェック一覧を読み取り専用で表示する（方針3）。操作UIは持たない（✓/○の静的表示）。
export function CompletionList({ items }: { items: CompletionItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2 rounded-md border border-border/50 px-3 py-2 text-sm">
          <span className="mt-0.5 w-5 shrink-0 text-center" aria-hidden>
            {item.done ? <span className="font-bold text-emerald-600">✓</span> : <span className="text-muted-foreground/50">○</span>}
          </span>
          <span className={cn('min-w-0 break-words', item.done ? 'text-muted-foreground' : 'text-foreground')}>
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}
