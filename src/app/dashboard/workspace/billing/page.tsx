import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PLAN_DEFINITIONS, PLAN_ORDER, type PlanId } from '@/lib/plans';
import { formatCurrency } from '@/lib/format';
import { BillingActions } from '@/components/workspace/billing-actions';
import { isStripeConfigured } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ space?: string; checkout?: string }>;
}

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

  const currentPlan = spaceRow.plan as PlanId;
  const isOwner = spaceRow.user_id === user.id;
  const stripeReady = isStripeConfigured();

  return (
    <div className="space-y-6">
      {checkout === 'success' && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          ✅ プラン変更が反映されました。少しでも反映が遅れる場合は数十秒お待ちください。
        </div>
      )}
      {checkout === 'cancelled' && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          チェックアウトをキャンセルしました。
        </div>
      )}
      {!stripeReady && (
        <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
          Stripeが未設定です。本番運用前に <code>STRIPE_SECRET_KEY</code> 等を <code>.env.local</code> に設定してください。
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>現在のプラン</span>
            <Badge>{PLAN_DEFINITIONS[currentPlan].jaName}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>月額</span>
            <span>{formatCurrency(PLAN_DEFINITIONS[currentPlan].priceUsdPerSeat * (spaceRow.seat_count ?? 1), 'USD')}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Seat数</span>
            <span>{spaceRow.seat_count ?? 1}</span>
          </div>
          {spaceRow.billing_current_period_end && (
            <div className="flex justify-between text-muted-foreground">
              <span>次回更新</span>
              <span>{new Date(spaceRow.billing_current_period_end).toLocaleDateString('ja-JP')}</span>
            </div>
          )}
          {spaceRow.billing_customer_id && isOwner && (
            <BillingActions spaceId={space} variant="portal" />
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">プランを選ぶ</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((planId) => {
            const plan = PLAN_DEFINITIONS[planId];
            const isCurrent = currentPlan === planId;
            const canSwitch = isOwner && planId !== 'free' && planId !== 'enterprise' && !isCurrent;
            return (
              <Card key={planId} className={isCurrent ? 'border-primary' : undefined}>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {plan.jaName}
                    {isCurrent && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        現在
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="text-xl font-bold text-foreground">
                    {formatCurrency(plan.priceUsdPerSeat, 'USD')}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">/月</span>
                  </div>
                  <p className="text-muted-foreground">{plan.description}</p>
                  <ul className="space-y-0.5">
                    <li>月 {plan.monthlyExecutionsPerSeat}回 / seat</li>
                    <li>最低 {plan.minSeats} seat〜</li>
                    {plan.features.macMiniSupport && <li>Mac mini連携</li>}
                    {plan.features.teamSharing && <li>チーム共有</li>}
                    {plan.features.adminDashboard && <li>管理画面</li>}
                    {plan.features.auditLog && <li>監査ログ</li>}
                    {plan.features.sso && <li>SSO/SAML</li>}
                    {plan.features.byok && <li>BYOK</li>}
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
                      className="inline-block text-xs text-primary hover:underline"
                    >
                      お問い合わせ
                    </a>
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
