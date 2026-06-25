import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PLAN_DEFINITIONS, PLAN_ORDER, type PlanId } from '@/lib/plans';
import { formatCurrency } from '@/lib/format';
import { BillingActions } from '@/components/workspace/billing-actions';
import { isStripeConfigured } from '@/lib/stripe';
import { UsageCard } from '@/components/usage/usage-card';
import {
  Check,
  Crown,
  Infinity as InfinityIcon,
  Server,
  Users,
  ShieldCheck,
  Key,
  BarChart3,
  Sparkles,
  CalendarClock,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ space?: string; checkout?: string }>;
}

const PLAN_THEME: Record<PlanId, { gradient: string; border: string; icon: typeof Crown }> = {
  free: { gradient: 'from-slate-50 to-transparent dark:from-slate-950/20', border: 'border-border', icon: Sparkles },
  personal: { gradient: 'from-blue-50 to-transparent dark:from-blue-950/20', border: 'border-blue-300/60 dark:border-blue-900/60', icon: Sparkles },
  team: { gradient: 'from-primary/[0.05] to-transparent', border: 'border-primary/40', icon: Users },
  enterprise: { gradient: 'from-amber-50 to-transparent dark:from-amber-950/20', border: 'border-amber-300/60 dark:border-amber-900/60', icon: Crown },
};

export default async function BillingPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { space, checkout } = await searchParams;
  if (!space) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Workspace を選択してください
        </CardContent>
      </Card>
    );
  }

  const { data: spaceRow } = await supabase
    .from('spaces')
    .select('id, title, plan, seat_count, billing_customer_id, billing_current_period_end, user_id')
    .eq('id', space)
    .maybeSingle();
  if (!spaceRow) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Workspace が見つかりません
        </CardContent>
      </Card>
    );
  }

  const currentPlan = (spaceRow.plan ?? 'free') as PlanId;
  const currentPlanDef = PLAN_DEFINITIONS[currentPlan];
  const currentTheme = PLAN_THEME[currentPlan];
  const CurrentIcon = currentTheme.icon;
  const isOwner = spaceRow.user_id === user.id;
  const stripeReady = isStripeConfigured();
  const seatCount = spaceRow.seat_count ?? 1;
  const monthlyTotal = currentPlanDef.priceUsdPerSeat * seatCount;

  return (
    <div className="space-y-6">
      {/* チェックアウトステータス */}
      {checkout === 'success' && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          ✅ プラン変更が反映されました。 反映が遅れる場合は数十秒お待ちください。
        </div>
      )}
      {checkout === 'cancelled' && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          チェックアウトをキャンセルしました。
        </div>
      )}
      {!stripeReady && (
        <div className="flex items-start gap-2 rounded-md border border-blue-300/60 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-800 dark:text-blue-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-medium">Stripeが未設定</p>
            <p className="opacity-90">
              本番でクレジット決済を有効化するには <code className="rounded bg-blue-100/60 dark:bg-blue-900/40 px-1">STRIPE_SECRET_KEY</code> / <code className="rounded bg-blue-100/60 dark:bg-blue-900/40 px-1">STRIPE_WEBHOOK_SECRET</code> を Cloud Run の環境変数に追加してください。
            </p>
          </div>
        </div>
      )}

      {/* 現在のプラン (大きく強調) */}
      <Card className={cn('overflow-hidden border-2 bg-gradient-to-br', currentTheme.border, currentTheme.gradient)}>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background shadow-sm">
                <CurrentIcon className="h-5 w-5 text-primary" />
              </span>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">現在のプラン</p>
                <h2 className="text-xl font-bold text-foreground">{currentPlanDef.jaName}</h2>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <p className="text-2xl font-bold tabular-nums">
                {currentPlan === 'enterprise' ? 'Custom' : formatCurrency(monthlyTotal, 'USD')}
                <span className="ml-1 text-xs font-normal text-muted-foreground">/月</span>
              </p>
              {currentPlan !== 'enterprise' && currentPlan !== 'free' && seatCount > 1 && (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {formatCurrency(currentPlanDef.priceUsdPerSeat, 'USD')} × {seatCount} seat
                </p>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{currentPlanDef.description}</p>

          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-background/60 px-2.5 py-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">
                月{' '}
                {isFinite(currentPlanDef.monthlyExecutionsPerSeat) ? (
                  `${currentPlanDef.monthlyExecutionsPerSeat}回`
                ) : (
                  <span className="inline-flex items-center gap-0.5">
                    <InfinityIcon className="h-3 w-3" />
                    無制限
                  </span>
                )}
                {seatCount > 1 ? ' / seat' : ''} 実行
              </span>
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-background/60 px-2.5 py-1.5">
              <Users className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">Seat {seatCount}</span>
            </div>
            {spaceRow.billing_current_period_end && (
              <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-background/60 px-2.5 py-1.5">
                <CalendarClock className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium">
                  次回更新 {new Date(spaceRow.billing_current_period_end).toLocaleDateString('ja-JP')}
                </span>
              </div>
            )}
          </div>

          {spaceRow.billing_customer_id && isOwner && (
            <BillingActions spaceId={space} variant="portal" />
          )}
        </CardContent>
      </Card>

      {/* 使用量ライブ表示 */}
      <UsageCard spaceId={space} userId={user.id} />

      {/* プラン比較 */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">プランを選ぶ</h2>
          <p className="text-[11px] text-muted-foreground">AI実行コストはユーザー自身のサブスク側</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((planId) => {
            const plan = PLAN_DEFINITIONS[planId];
            const theme = PLAN_THEME[planId];
            const PlanIcon = theme.icon;
            const isCurrent = currentPlan === planId;
            const isRecommended = planId === 'team' && !isCurrent;
            const canSwitch = isOwner && planId !== 'free' && planId !== 'enterprise' && !isCurrent;

            const features = [
              {
                icon: Sparkles,
                label: isFinite(plan.monthlyExecutionsPerSeat)
                  ? `月 ${plan.monthlyExecutionsPerSeat}回${plan.minSeats > 1 ? '/seat' : ''} 実行`
                  : '無制限の実行',
                key: 'executions',
              },
              ...(plan.features.macMiniSupport ? [{ icon: Server, label: 'Mac mini 連携', key: 'mac' }] : []),
              ...(plan.features.teamSharing ? [{ icon: Users, label: 'チーム共有', key: 'team' }] : []),
              ...(plan.features.adminDashboard ? [{ icon: BarChart3, label: '管理画面 + Analytics', key: 'admin' }] : []),
              ...(plan.features.auditLog ? [{ icon: ShieldCheck, label: '監査ログ', key: 'audit' }] : []),
              ...(plan.features.sso ? [{ icon: ShieldCheck, label: 'SSO / SAML', key: 'sso' }] : []),
              ...(plan.features.byok ? [{ icon: Key, label: 'BYOK', key: 'byok' }] : []),
            ];

            return (
              <Card
                key={planId}
                className={cn(
                  'relative overflow-hidden transition-all gap-3 py-4',
                  isCurrent && 'border-primary ring-2 ring-primary/20',
                  isRecommended && 'border-primary/40',
                  !isCurrent && !isRecommended && 'hover:border-primary/30 hover:shadow-sm',
                )}
              >
                {isRecommended && (
                  <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold uppercase text-primary-foreground">
                    推奨
                  </span>
                )}

                <CardHeader className="pb-1">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <PlanIcon className="h-4 w-4 text-primary" />
                    {plan.jaName}
                    {isCurrent && (
                      <Badge variant="secondary" className="text-[9px]">
                        現在
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="space-y-0.5">
                    {planId === 'enterprise' ? (
                      <p className="text-lg font-bold">お問い合わせ</p>
                    ) : (
                      <>
                        <p className="text-2xl font-bold tabular-nums">
                          {formatCurrency(plan.priceUsdPerSeat, 'USD')}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            /月{plan.minSeats > 1 ? ' × seat' : ''}
                          </span>
                        </p>
                        {plan.minSeats > 1 && (
                          <p className="text-[10px] text-muted-foreground">最低 {plan.minSeats} seat〜</p>
                        )}
                      </>
                    )}
                  </div>

                  <p className="text-muted-foreground leading-relaxed line-clamp-3 min-h-[3em]">
                    {plan.description}
                  </p>

                  <ul className="space-y-1">
                    {features.map((f) => (
                      <li key={f.key} className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                        <span className="flex items-center gap-1">
                          <f.icon className="h-3 w-3 text-muted-foreground/70" />
                          {f.label}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {canSwitch && (
                    <BillingActions
                      spaceId={space}
                      variant="checkout"
                      plan={planId}
                      label={planId === 'team' ? `${plan.minSeats}seat〜で開始` : 'プランを選ぶ'}
                    />
                  )}
                  {planId === 'enterprise' && !isCurrent && (
                    <a
                      href="mailto:hello@focusmap-official.com?subject=Enterprise%20Plan%20Inquiry"
                      className="inline-flex w-full items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors"
                    >
                      お問い合わせ
                    </a>
                  )}
                  {!canSwitch && planId !== 'enterprise' && isCurrent && (
                    <p className="text-center text-[10px] text-muted-foreground">利用中</p>
                  )}
                  {!isOwner && !isCurrent && (
                    <p className="text-center text-[10px] text-muted-foreground">
                      Ownerのみ変更可
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
