'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, Activity, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { UsageBar } from '@/components/usage/usage-bar';
import { useUsage } from '@/hooks/use-usage';
import { formatCurrency } from '@/lib/format';
import { createClient } from '@/utils/supabase/client';

interface UsageCardProps {
  spaceId: string | null;
  /** 指定しない場合は内部で auth.getUser() から取得 */
  userId?: string | null;
  compact?: boolean;
}

export function UsageCard({ spaceId, userId: userIdProp, compact }: UsageCardProps) {
  const [userId, setUserId] = useState<string | null>(userIdProp ?? null);

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

  const { personal, workspace, loading, error } = useUsage(spaceId, userId);

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
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4" />
          使用量の取得に失敗しました
        </CardContent>
      </Card>
    );
  }

  const showUpgradePrompt = personal.ratio >= 0.8;

  return (
    <Card className={compact ? 'gap-3 py-4' : undefined}>
      <CardHeader className={compact ? 'pb-1' : undefined}>
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            今月の使用量
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {personal.planName}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <UsageBar label="あなた" usage={personal} compact={compact} />
        {workspace && (
          <UsageBar label="Workspace全体" usage={workspace} compact={compact} />
        )}
        {!compact && (
          <div className="flex flex-col gap-1 rounded-md border border-dashed border-border/50 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            <div className="flex justify-between">
              <span>累計トークン</span>
              <span>
                入 {Math.round(personal.inputTokens / 1000)}K / 出{' '}
                {Math.round(personal.outputTokens / 1000)}K
              </span>
            </div>
            <div className="flex justify-between">
              <span>推定原価</span>
              <span>{formatCurrency(personal.costUsd, 'USD', true)}</span>
            </div>
          </div>
        )}
        {showUpgradePrompt && (
          <Button asChild size="sm" className="w-full gap-1">
            <Link href="/dashboard/workspace/billing">
              <Sparkles className="h-3.5 w-3.5" />
              プランをアップグレード
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
