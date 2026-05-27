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
import { Sparkles, Check, Zap, AlertTriangle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { PLAN_DEFINITIONS, PLAN_ORDER, type PlanId } from '@/lib/plans';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan?: PlanId;
  reason?: string;
}

// 推奨表示順 (Free は除外、Enterprise は問い合わせ)
const UPGRADE_TARGETS: PlanId[] = PLAN_ORDER.filter(
  (p) => p !== 'free',
) as PlanId[];

export function UpgradeModal({
  open,
  onOpenChange,
  currentPlan = 'free',
  reason,
}: UpgradeModalProps) {
  const initialPlan: PlanId =
    currentPlan === 'free' ? 'personal' : currentPlan === 'personal' ? 'team' : 'enterprise';
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(initialPlan);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const handleCheckout = async () => {
    if (selectedPlan === 'enterprise') return;
    setCheckingOut(true);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 503) {
          // Stripe未設定: billing ページにフォールバック
          window.location.href = `/dashboard/workspace/billing?plan=${selectedPlan}`;
          return;
        }
        throw new Error(data?.error || 'Checkout に失敗しました');
      }
      if (data.url) {
        window.location.href = data.url as string;
        return;
      }
      // url 取れず → billing ページへ
      window.location.href = `/dashboard/workspace/billing?plan=${selectedPlan}`;
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'Checkout に失敗しました');
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
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

        <div className="grid gap-3 sm:grid-cols-3">
          {UPGRADE_TARGETS.map((planId) => {
            const plan = PLAN_DEFINITIONS[planId];
            const isSelected = selectedPlan === planId;
            const isCurrent = currentPlan === planId;
            const isHighlight = planId === 'team';
            const isContact = planId === 'enterprise';

            return (
              <Card
                key={planId}
                role="button"
                tabIndex={0}
                aria-selected={isSelected}
                className={cn(
                  'cursor-pointer transition-all relative p-4 gap-2',
                  isSelected
                    ? 'border-primary ring-2 ring-primary/30 shadow-sm'
                    : 'hover:border-primary/40 hover:shadow-sm',
                  isCurrent && 'opacity-60 cursor-not-allowed',
                  isHighlight && !isCurrent && 'border-primary/40 bg-primary/[0.03]',
                )}
                onClick={() => !isCurrent && setSelectedPlan(planId)}
                onKeyDown={(e) => {
                  if (!isCurrent && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setSelectedPlan(planId);
                  }
                }}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="font-semibold text-sm">{plan.jaName}</h3>
                    {isCurrent && (
                      <Badge variant="secondary" className="text-[9px]">
                        現在
                      </Badge>
                    )}
                  </div>
                  {isHighlight && !isCurrent && (
                    <Badge className="text-[9px] gap-0.5 shrink-0">
                      <Zap className="h-2.5 w-2.5" />
                      推奨
                    </Badge>
                  )}
                </div>

                <p className="text-[11px] text-muted-foreground line-clamp-2 min-h-[2rem]">
                  {plan.description}
                </p>

                <div className="flex items-baseline gap-1">
                  {isContact ? (
                    <span className="text-lg font-bold">お問い合わせ</span>
                  ) : (
                    <>
                      <span className="text-2xl font-bold">
                        {formatCurrency(plan.priceUsdPerSeat, 'USD')}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        /月{plan.minSeats > 1 ? ` × seat` : ''}
                      </span>
                    </>
                  )}
                </div>
                {!isContact && plan.minSeats > 1 && (
                  <p className="text-[10px] text-muted-foreground">最低 {plan.minSeats} seat〜</p>
                )}

                <ul className="space-y-1 text-xs">
                  <li className="flex items-start gap-1.5">
                    <Check className="h-3 w-3 mt-0.5 text-emerald-500 shrink-0" />
                    <span>
                      月 {isFinite(plan.monthlyExecutionsPerSeat) ? plan.monthlyExecutionsPerSeat : '∞'}回
                      {plan.minSeats > 1 ? '/seat' : ''} 実行
                    </span>
                  </li>
                  {plan.features.macMiniSupport && (
                    <li className="flex items-start gap-1.5">
                      <Check className="h-3 w-3 mt-0.5 text-emerald-500 shrink-0" />
                      <span>Mac mini 連携</span>
                    </li>
                  )}
                  {plan.features.teamSharing && (
                    <li className="flex items-start gap-1.5">
                      <Check className="h-3 w-3 mt-0.5 text-emerald-500 shrink-0" />
                      <span>チーム共有</span>
                    </li>
                  )}
                  {plan.features.adminDashboard && (
                    <li className="flex items-start gap-1.5">
                      <Check className="h-3 w-3 mt-0.5 text-emerald-500 shrink-0" />
                      <span>管理画面 + Analytics</span>
                    </li>
                  )}
                  {plan.features.auditLog && (
                    <li className="flex items-start gap-1.5">
                      <Check className="h-3 w-3 mt-0.5 text-emerald-500 shrink-0" />
                      <span>監査ログ</span>
                    </li>
                  )}
                  {plan.features.sso && (
                    <li className="flex items-start gap-1.5">
                      <Check className="h-3 w-3 mt-0.5 text-emerald-500 shrink-0" />
                      <span>SSO / SAML</span>
                    </li>
                  )}
                  {plan.features.byok && (
                    <li className="flex items-start gap-1.5">
                      <Check className="h-3 w-3 mt-0.5 text-emerald-500 shrink-0" />
                      <span>BYOK (API key 持ち込み)</span>
                    </li>
                  )}
                </ul>
              </Card>
            );
          })}
        </div>

        {checkoutError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {checkoutError}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            あとで
          </Button>
          {selectedPlan === 'enterprise' ? (
            <Button asChild className="gap-1">
              <Link href="mailto:hello@focusmap-official.com">
                <Sparkles className="h-3.5 w-3.5" />
                お問い合わせ
              </Link>
            </Button>
          ) : (
            <Button onClick={handleCheckout} disabled={checkingOut || selectedPlan === currentPlan} className="gap-1">
              {checkingOut ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {selectedPlan === currentPlan
                ? '現在のプランです'
                : `${PLAN_DEFINITIONS[selectedPlan].jaName} にアップグレード`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
