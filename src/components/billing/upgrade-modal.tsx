'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Sparkles, Check, Zap, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { PLAN_DEFINITIONS, type PlanId } from '@/lib/plans';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan?: PlanId;
  reason?: string;
}

const RECOMMENDED_PLANS: PlanId[] = ['personal', 'team'];

export function UpgradeModal({
  open,
  onOpenChange,
  currentPlan = 'free',
  reason,
}: UpgradeModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(
    currentPlan === 'free' ? 'personal' : 'team',
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            プランをアップグレード
          </DialogTitle>
          <DialogDescription>
            {reason ?? '今月の実行上限に達しました。プランを切り替えるとさらに自動化が使えます。'}
          </DialogDescription>
        </DialogHeader>

        {reason && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{reason}</span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {RECOMMENDED_PLANS.map((planId) => {
            const plan = PLAN_DEFINITIONS[planId];
            const isSelected = selectedPlan === planId;
            const isCurrent = currentPlan === planId;
            return (
              <Card
                key={planId}
                className={cn(
                  'cursor-pointer transition-all relative p-4 gap-2',
                  isSelected ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/40',
                  isCurrent && 'opacity-60',
                )}
                onClick={() => !isCurrent && setSelectedPlan(planId)}
              >
                <div className="flex items-baseline justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{plan.jaName}</h3>
                    {isCurrent && (
                      <Badge variant="secondary" className="text-[10px]">
                        現在のプラン
                      </Badge>
                    )}
                  </div>
                  {planId === 'team' && (
                    <Badge className="text-[10px] gap-0.5">
                      <Zap className="h-2.5 w-2.5" />
                      推奨
                    </Badge>
                  )}
                </div>

                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold">{formatCurrency(plan.priceUsdPerSeat, 'USD')}</span>
                  <span className="text-xs text-muted-foreground">
                    /月 {plan.minSeats > 1 ? `× 最低${plan.minSeats}seat` : ''}
                  </span>
                </div>

                <ul className="space-y-1 text-xs">
                  <li className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-emerald-500" />
                    月 {plan.monthlyExecutionsPerSeat}回/seat 実行
                  </li>
                  {plan.features.macMiniSupport && (
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-emerald-500" />
                      Mac mini 連携
                    </li>
                  )}
                  {plan.features.teamSharing && (
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-emerald-500" />
                      チーム共有
                    </li>
                  )}
                  {plan.features.adminDashboard && (
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-emerald-500" />
                      管理画面 + Analytics
                    </li>
                  )}
                  {plan.features.auditLog && (
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-emerald-500" />
                      監査ログ
                    </li>
                  )}
                </ul>
              </Card>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            あとで
          </Button>
          <Button asChild className="gap-1">
            <Link href={`/dashboard/workspace/billing?plan=${selectedPlan}`}>
              <Sparkles className="h-3.5 w-3.5" />
              {PLAN_DEFINITIONS[selectedPlan].jaName} にアップグレード
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
