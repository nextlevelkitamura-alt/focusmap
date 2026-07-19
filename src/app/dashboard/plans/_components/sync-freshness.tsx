'use client';

import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { formatFreshness } from '../_lib/md-parse';

// ヘッダの「最終同期N分前」。30分超はamberで視覚的に古さを示す。タップで再取得（router.refresh）。
export function SyncFreshness({ syncedAt, className }: { syncedAt: string; className?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [now] = useState(() => Date.now());
  const { label, stale } = formatFreshness(syncedAt, now);
  if (!label) return null;

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
        stale ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400' : 'bg-muted text-muted-foreground',
        className,
      )}
      aria-label="最終同期を再取得"
    >
      <RefreshCw className={cn('h-3.5 w-3.5', isPending && 'animate-spin')} />
      最終同期 {label}
    </button>
  );
}
