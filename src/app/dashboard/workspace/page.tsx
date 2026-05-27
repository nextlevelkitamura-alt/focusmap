import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { createClient } from '@/utils/supabase/server';
import { PLAN_DEFINITIONS, getMonthlyExecutionLimit, type PlanId } from '@/lib/plans';
import { formatCurrency, formatBillingCycle } from '@/lib/format';
import { Users, CreditCard, BarChart3, Server, ArrowRight, Sparkles } from 'lucide-react';
import { UsageCard } from '@/components/usage/usage-card';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ space?: string }>;
}

async function resolveActiveSpaceId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  spaceParam: string | undefined,
): Promise<string | null> {
  if (spaceParam) return spaceParam;
  const { data: ownedSpace } = await supabase
    .from('spaces')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return ownedSpace?.id ?? null;
}

export default async function WorkspaceOverviewPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { space } = await searchParams;
  const spaceId = await resolveActiveSpaceId(supabase, user.id, space);
  if (!spaceId) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Workspaceが見つかりません。ダッシュボードで新規作成してください。
      </div>
    );
  }

  const { data: spaceRow } = await supabase
    .from('spaces')
    .select('id, title, plan, seat_count, billing_current_period_end, billing_subscription_id')
    .eq('id', spaceId)
    .maybeSingle();

  if (!spaceRow) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Workspaceが見つかりません。
      </div>
    );
  }

  const plan = PLAN_DEFINITIONS[spaceRow.plan as PlanId] ?? PLAN_DEFINITIONS.free;
  const seatCount = spaceRow.seat_count ?? 1;
  const totalLimit = getMonthlyExecutionLimit(plan.id, seatCount);
  const totalPriceUsd = plan.priceUsdPerSeat * Math.max(seatCount, plan.minSeats);

  const cycle = formatBillingCycle();
  const { data: summary } = await supabase.rpc('get_usage_summary', {
    p_space_id: spaceId,
    p_user_id: user.id,
    p_cycle: cycle,
  });
  type Summary = { scope: 'user' | 'space'; executions: number; cost_usd: number };
  const spaceSummary = ((summary ?? []) as Summary[]).find((s) => s.scope === 'space');

  const { count: memberCount } = await supabase
    .from('space_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('space_id', spaceId);

  const { data: runners } = await supabase
    .from('ai_runners')
    .select('id, hostname, last_heartbeat_at, ai_runner_spaces!inner(space_id)')
    .eq('ai_runner_spaces.space_id', spaceId);

  const activeRunnerCount = (runners ?? []).filter((r) => {
    if (!r.last_heartbeat_at) return false;
    const lastSeen = new Date(r.last_heartbeat_at).getTime();
    return Date.now() - lastSeen < 2 * 60 * 1000;
  }).length;

  const query = spaceId ? `?space=${spaceId}` : '';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Workspace</p>
              <CardTitle className="text-xl">{spaceRow.title}</CardTitle>
            </div>
            <Badge className="gap-1 text-xs">
              <Sparkles className="h-3 w-3" />
              {plan.jaName}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="月額" value={formatCurrency(totalPriceUsd, 'USD')} />
          <Stat label="今月の実行" value={`${(spaceSummary?.executions ?? 0).toLocaleString()} / ${isFinite(totalLimit) ? totalLimit.toLocaleString() : '∞'}`} />
          <Stat label="メンバー" value={`${memberCount ?? 0}人`} />
          <Stat label="稼働中エージェント" value={`${activeRunnerCount} 台`} />
        </CardContent>
      </Card>

      {/* 使用量バー (Claude Code 型、 残量・警告アイコン付き) */}
      <UsageCard spaceId={spaceId} userId={user.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        <ShortcutCard
          icon={Users}
          title="メンバー管理"
          description="招待・Role変更・削除"
          href={`/dashboard/workspace/members${query}`}
        />
        <ShortcutCard
          icon={CreditCard}
          title="課金・プラン"
          description="アップグレード / 請求履歴"
          href={`/dashboard/workspace/billing${query}`}
        />
        <ShortcutCard
          icon={BarChart3}
          title="使用量Analytics"
          description="月別グラフ / トークン消費"
          href={`/dashboard/workspace/analytics${query}`}
        />
        <ShortcutCard
          icon={Server}
          title="エージェント"
          description="Mac mini 接続 / install.sh"
          href={`/dashboard/workspace/agents${query}`}
        />
      </div>

      {spaceRow.billing_current_period_end && (
        <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
          次回更新: {new Date(spaceRow.billing_current_period_end).toLocaleDateString('ja-JP')}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function ShortcutCard({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: typeof Users;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Button asChild variant="outline" className="h-auto justify-between gap-3 px-4 py-3 text-left">
      <Link href={href}>
        <span className="flex items-start gap-3">
          <Icon className="h-5 w-5 mt-0.5 text-primary" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{title}</span>
            <span className="text-xs text-muted-foreground">{description}</span>
          </span>
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </Button>
  );
}
