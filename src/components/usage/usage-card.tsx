'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, Activity, AlertTriangle, ArrowUpRight, RefreshCw } from 'lucide-react';
import { UsageBar } from '@/components/usage/usage-bar';
import { useUsage } from '@/hooks/use-usage';
import { formatCurrency } from '@/lib/format';
import { createClient } from '@/utils/supabase/client';
import { UpgradeModal } from '@/components/billing/upgrade-modal';
import type { PlanId } from '@/lib/plans';
import { cn } from '@/lib/utils';

interface UsageCardProps {
  spaceId: string | null;
  /** 指定しない場合は内部で auth.getUser() から取得 */
  userId?: string | null;
  compact?: boolean;
}

export function UsageCard({ spaceId, userId: userIdProp, compact }: UsageCardProps) {
  const [userId, setUserId] = useState<string | null>(userIdProp ?? null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (userIdProp !== undefined) {
      setUserId(userIdProp ?? null);
      return;
    }
    let mounted = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (mounted) setUserId(data.user?.id ?? null);
      });
    return () => {
      mounted = false;
    };
  }, [userIdProp]);

  const { personal, workspace, loading, error, refresh } = useUsage(spaceId, userId);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      // animation feedback for at least 400ms
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  if (loading) {
    return (
      <Card className={compact ? 'p-4' : undefined}>
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Activity className="h-4 w-4 animate-pulse" />
          使用量を取得中…
        </CardContent>
      </Card>
    );
  }

  if (error || !personal) {
    return (
      <Card className={compact ? 'p-4' : undefined}>
        <CardContent className="space-y-2 py-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            使用量の取得に失敗しました
          </div>
          <Button size="sm" variant="outline" onClick={handleRefresh} className="gap-1">
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
            再試行
          </Button>
        </CardContent>
      </Card>
    );
  }

  const personalCritical = personal.ratio >= 0.95;
  const personalWarning = personal.ratio >= 0.8 && !personalCritical;
  const workspaceCritical = (workspace?.ratio ?? 0) >= 0.95;
  const showStrongPrompt = personalCritical || workspaceCritical;
  const showSoftPrompt = !showStrongPrompt && (personalWarning || (workspace?.ratio ?? 0) >= 0.8);

  const currentPlan = (personal.planId ?? 'free') as PlanId;

  return (
    <>
      <Card
        className={cn(
          compact ? 'gap-3 py-4' : undefined,
          showStrongPrompt && 'border-red-300 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20',
          !showStrongPrompt &&
            showSoftPrompt &&
            'border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20',
        )}
      >
        <CardHeader className={compact ? 'pb-1' : undefined}>
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              今月の使用量
            </span>
            <span className="flex items-center gap-1">
              <Badge variant="secondary" className="text-[10px]">
                {personal.planName}
              </Badge>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-label="使用量を更新"
                title="使用量を更新"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
              >
                <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
              </button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <UsageBar label="あなた" usage={personal} compact={compact} />
          {workspace ? (
            <UsageBar label="Workspace全体" usage={workspace} compact={compact} />
          ) : (
            !compact && spaceId && (
              <div className="rounded-md border border-dashed border-border/40 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                Workspaceの集計はメンバー2人以上から表示されます。
              </div>
            )
          )}

          {!compact && (
            <div className="flex flex-col gap-1 rounded-md border border-dashed border-border/50 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              <div className="flex justify-between">
                <span>累計トークン</span>
                <span className="tabular-nums">
                  入 {Math.round(personal.inputTokens / 1000)}K / 出{' '}
                  {Math.round(personal.outputTokens / 1000)}K
                </span>
              </div>
              <div className="flex justify-between">
                <span>推定原価</span>
                <span className="tabular-nums">{formatCurrency(personal.costUsd, 'USD', true)}</span>
              </div>
            </div>
          )}

          {showStrongPrompt && (
            <div className="space-y-2 rounded-md border border-red-300/60 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40 px-3 py-2.5">
              <p className="text-xs font-medium text-red-700 dark:text-red-300">
                ⛔ 月間上限に到達しました。次の実行は失敗します。
              </p>
              <Button
                size="sm"
                className="w-full gap-1 bg-red-600 hover:bg-red-700 text-white"
                onClick={() => setUpgradeOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                今すぐアップグレード
                <ArrowUpRight className="h-3 w-3" />
              </Button>
            </div>
          )}

          {!showStrongPrompt && showSoftPrompt && (
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1 border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300"
              onClick={() => setUpgradeOpen(true)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              プランをアップグレード
            </Button>
          )}
        </CardContent>
      </Card>

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        currentPlan={currentPlan}
        spaceId={spaceId}
        reason={
          showStrongPrompt
            ? '今月の実行上限に到達しました。プランを切り替えると、すぐに自動化を再開できます。'
            : '上限に近づいています。リセットを待たずに使い続けたい場合はアップグレードをご検討ください。'
        }
      />
    </>
  );
}
