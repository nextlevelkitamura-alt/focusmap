import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AnalyticsChart } from '@/components/workspace/analytics-chart';
import { formatCurrency, formatTokens, formatBillingCycle } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ space?: string }>;
}

interface UsageRow {
  billing_cycle: string;
  executions: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { space } = await searchParams;
  if (!space) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Workspace を選択してください
        </CardContent>
      </Card>
    );
  }

  // 過去6ヶ月の使用量集計
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 5);
  sixMonthsAgo.setUTCDate(1);
  sixMonthsAgo.setUTCHours(0, 0, 0, 0);

  const { data: usageRows } = await supabase
    .from('ai_usage')
    .select('billing_cycle, input_tokens, output_tokens, cost_usd')
    .eq('space_id', space)
    .gte('created_at', sixMonthsAgo.toISOString());

  // billing_cycleごとに集計
  const byCycle = new Map<string, UsageRow>();
  for (const row of (usageRows ?? []) as Array<{ billing_cycle: string | null; input_tokens: number; output_tokens: number; cost_usd: number }>) {
    const cycle = row.billing_cycle ?? formatBillingCycle();
    const existing = byCycle.get(cycle) ?? {
      billing_cycle: cycle,
      executions: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    };
    existing.executions += 1;
    existing.input_tokens += row.input_tokens ?? 0;
    existing.output_tokens += row.output_tokens ?? 0;
    existing.cost_usd += Number(row.cost_usd ?? 0);
    byCycle.set(cycle, existing);
  }

  // 直近6ヶ月の cycle を埋める (データなしも0で表示)
  const cycles: string[] = [];
  const cursor = new Date(sixMonthsAgo);
  for (let i = 0; i < 6; i++) {
    cycles.push(formatBillingCycle(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const monthlyData = cycles.map((cycle) => byCycle.get(cycle) ?? {
    billing_cycle: cycle,
    executions: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
  });

  // スキル別 (今月)
  const currentCycle = formatBillingCycle();
  const { data: bySkill } = await supabase
    .from('ai_usage')
    .select('feature, input_tokens, output_tokens, cost_usd')
    .eq('space_id', space)
    .eq('billing_cycle', currentCycle);

  const skillMap = new Map<string, { count: number; cost: number }>();
  for (const row of (bySkill ?? []) as Array<{ feature: string; cost_usd: number }>) {
    const key = row.feature ?? 'other';
    const existing = skillMap.get(key) ?? { count: 0, cost: 0 };
    existing.count += 1;
    existing.cost += Number(row.cost_usd ?? 0);
    skillMap.set(key, existing);
  }
  const skillRanking = Array.from(skillMap.entries())
    .map(([feature, val]) => ({ feature, ...val }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const currentMonth = monthlyData[monthlyData.length - 1];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4 space-y-1">
            <div className="text-xs text-muted-foreground">今月の実行</div>
            <div className="text-2xl font-bold">{currentMonth.executions.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 space-y-1">
            <div className="text-xs text-muted-foreground">今月の消費トークン</div>
            <div className="text-2xl font-bold">
              {formatTokens(currentMonth.input_tokens + currentMonth.output_tokens)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              入 {formatTokens(currentMonth.input_tokens)} / 出 {formatTokens(currentMonth.output_tokens)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 space-y-1">
            <div className="text-xs text-muted-foreground">今月の推定原価</div>
            <div className="text-2xl font-bold">{formatCurrency(currentMonth.cost_usd, 'USD', true)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">月別 実行回数の推移</CardTitle>
        </CardHeader>
        <CardContent className="px-2">
          <AnalyticsChart data={monthlyData} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">スキル別 利用ランキング (今月)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {skillRanking.length === 0 && (
            <p className="text-sm text-muted-foreground">今月の実行履歴がまだありません。</p>
          )}
          {skillRanking.map((row) => (
            <div
              key={row.feature}
              className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">{row.feature}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{row.count} 回</Badge>
                <span className="text-xs text-muted-foreground">
                  {formatCurrency(row.cost, 'USD', true)}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
