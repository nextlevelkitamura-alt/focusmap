import Link from 'next/link';
import { ChevronRight, ListChecks, ListTree } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { deriveNextStep, formatFreshness, parseMetaHeader } from '../_lib/md-parse';
import { MetaBadges } from './meta-badges';
import type { PlanDocKind, PlanProgress } from '@/lib/turso/plan-docs';

type PlanCardProps = {
  slug: string;
  title: string;
  kind: PlanDocKind;
  body: string;
  syncedAt: string;
  progress: PlanProgress | undefined;
};

export function PlanCard({ slug, title, kind, body, syncedAt, progress }: PlanCardProps) {
  const meta = parseMetaHeader(body);
  const parseOk = progress ? progress.parseOk : true;
  // parse_ok=0（またはprogress未取得）は集計を出さず「本文を開く」だけへフォールバック（方針5）。
  const nextStep = parseOk ? deriveNextStep(body, kind === 'program' ? 'program' : 'single') : '';
  const freshness = formatFreshness(syncedAt);

  return (
    <Link href={`/dashboard/plans/${encodeURIComponent(slug)}`} className="block">
      <Card className="transition-colors active:bg-muted/60">
        <CardContent className="space-y-2 p-3.5 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {kind === 'program' ? (
                <ListTree className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <h3 className="min-w-0 truncate text-sm font-bold">{title || slug}</h3>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>

          <MetaBadges meta={meta} />

          {parseOk && progress && kind === 'program' && progress.childTotal > 0 ? (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-semibold tabular-nums">
                子 {progress.childDone}/{progress.childTotal}
              </span>
              <span className="font-semibold tabular-nums">
                完了条件 {progress.condDone}/{progress.condTotal}
              </span>
            </div>
          ) : null}

          {nextStep ? (
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-medium text-foreground">次:</span> {nextStep}
            </p>
          ) : !parseOk ? (
            <p className={cn('text-xs text-amber-700 dark:text-amber-400')}>構造を自動抽出できませんでした。本文を開いて確認してください。</p>
          ) : null}

          {freshness.label ? (
            <p className={cn('text-[11px]', freshness.stale ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
              同期 {freshness.label}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}
