'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Sparkles, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUsage } from '@/hooks/use-usage';
import { UpgradeModal } from '@/components/billing/upgrade-modal';
import { createClient } from '@/utils/supabase/client';
import { formatPercent } from '@/lib/format';
import type { PlanId } from '@/lib/plans';
import { cn } from '@/lib/utils';

interface UsageStickyBannerProps {
  spaceId: string | null;
}

/**
 * チャット画面上部に表示する残量バナー。
 * - 残量 >50% : 表示なし
 * - 残量 ≤50% (= ratio 0.5 以上) : 控えめなインフォメーション
 * - 残量 ≤20% (= ratio 0.8+) : 黄色警告 + アップグレードボタン
 * - 残量 0 (= ratio 1.0+) : 赤いエラー + 強調されたアップグレード CTA
 */
export function UsageStickyBanner({ spaceId }: UsageStickyBannerProps) {
  const [userId, setUserId] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (mounted) setUserId(data.user?.id ?? null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const { personal } = useUsage(spaceId, userId);

  if (!personal) return null;
  if (!isFinite(personal.limit)) return null;
  if (personal.ratio < 0.5) return null;

  const ratio = personal.ratio;
  const remaining = Math.max(0, personal.limit - personal.executions);
  const isOver = ratio >= 1.0;
  const isCritical = ratio >= 0.8 && !isOver;
  const isSoft = ratio >= 0.5 && ratio < 0.8;

  const currentPlan = (personal.planId ?? 'free') as PlanId;

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs',
          isOver && 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200',
          isCritical && 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
          isSoft && 'border-border/40 bg-muted/30 text-muted-foreground',
        )}
      >
        {isOver || isCritical ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Clock className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="font-medium">
          {isOver
            ? `今月の上限に到達 (${personal.executions}/${personal.limit}回)`
            : isCritical
            ? `残り ${remaining}回 (${formatPercent(ratio, 0)} 使用)`
            : `今月 ${personal.executions}/${personal.limit}回 使用 (${formatPercent(ratio, 0)})`}
        </span>
        <span className="text-[10px] opacity-80">あと {personal.daysUntilReset}日でリセット</span>
        <div className="flex-1" />
        {(isOver || isCritical) && (
          <Button
            size="sm"
            className={cn(
              'h-6 gap-1 text-[11px]',
              isOver && 'bg-red-600 hover:bg-red-700 text-white',
              isCritical && 'border-amber-400 bg-amber-100 hover:bg-amber-200 text-amber-900 dark:border-amber-700 dark:bg-amber-900/60 dark:text-amber-100',
            )}
            onClick={() => setUpgradeOpen(true)}
            variant={isOver ? 'default' : 'outline'}
          >
            <Sparkles className="h-3 w-3" />
            アップグレード
          </Button>
        )}
      </div>

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        currentPlan={currentPlan}
        spaceId={spaceId}
        reason={
          isOver
            ? '今月の実行上限に到達しました。プランを切り替えると、すぐに自動化を再開できます。'
            : '残量が少なくなっています。リセットを待たずに使い続けたい場合はアップグレードをご検討ください。'
        }
      />
    </>
  );
}
