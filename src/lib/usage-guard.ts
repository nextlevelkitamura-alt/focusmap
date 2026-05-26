/**
 * プラン上限check & 使用量取得
 *
 * - ai_tasks INSERT 前に assertCanExecute を呼ぶ
 * - 使用量UI (バー / カード) から getUsageInfo を呼ぶ
 * - DB 関数 get_usage_summary を使って効率的にカウント
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatBillingCycle, daysUntilCycleReset } from '@/lib/format';
import { getMonthlyExecutionLimit, getPlan, type PlanId } from '@/lib/plans';

export interface UsageInfo {
  scope: 'user' | 'space';
  planId: PlanId;
  planName: string;
  executions: number;
  limit: number;
  remaining: number;
  ratio: number;
  cycle: string;
  daysUntilReset: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  seatCount: number;
}

export interface UsageCheckResult {
  allowed: boolean;
  reason?: 'over_monthly_limit' | 'rate_limit' | 'plan_inactive';
  message?: string;
  usage?: UsageInfo;
}

interface SpaceMeta {
  id: string;
  plan: PlanId;
  seat_count: number;
}

async function fetchSpaceMeta(
  supabase: SupabaseClient,
  spaceId: string | null,
): Promise<SpaceMeta | null> {
  if (!spaceId) return null;
  const { data, error } = await supabase
    .from('spaces')
    .select('id, plan, seat_count')
    .eq('id', spaceId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    plan: (data.plan ?? 'free') as PlanId,
    seat_count: Number(data.seat_count ?? 1),
  };
}

interface RawSummary {
  scope: 'user' | 'space';
  executions: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

async function fetchUsageSummary(
  supabase: SupabaseClient,
  spaceId: string | null,
  userId: string,
  cycle: string,
): Promise<{ user: RawSummary; space: RawSummary | null }> {
  const { data, error } = await supabase.rpc('get_usage_summary', {
    p_space_id: spaceId,
    p_user_id: userId,
    p_cycle: cycle,
  });
  if (error || !data) {
    return {
      user: { scope: 'user', executions: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
      space: null,
    };
  }
  const rows = data as RawSummary[];
  const user = rows.find((r) => r.scope === 'user') ?? {
    scope: 'user' as const,
    executions: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
  };
  const space = rows.find((r) => r.scope === 'space') ?? null;
  return { user, space };
}

export async function getUsageInfo(
  supabase: SupabaseClient,
  spaceId: string | null,
  userId: string,
): Promise<{ personal: UsageInfo; workspace: UsageInfo | null }> {
  const cycle = formatBillingCycle();
  const spaceMeta = await fetchSpaceMeta(supabase, spaceId);
  const planId: PlanId = spaceMeta?.plan ?? 'free';
  const seatCount = spaceMeta?.seat_count ?? 1;
  const plan = getPlan(planId);
  const summaries = await fetchUsageSummary(supabase, spaceMeta?.id ?? null, userId, cycle);

  const personalLimit = plan.monthlyExecutionsPerSeat;
  const personalExec = summaries.user.executions;
  const personalRatio = isFinite(personalLimit) ? personalExec / Math.max(personalLimit, 1) : 0;

  const personal: UsageInfo = {
    scope: 'user',
    planId,
    planName: plan.jaName,
    executions: personalExec,
    limit: personalLimit,
    remaining: Math.max(personalLimit - personalExec, 0),
    ratio: Math.min(personalRatio, 1),
    cycle,
    daysUntilReset: daysUntilCycleReset(),
    inputTokens: summaries.user.input_tokens,
    outputTokens: summaries.user.output_tokens,
    costUsd: summaries.user.cost_usd,
    seatCount,
  };

  let workspace: UsageInfo | null = null;
  if (spaceMeta && summaries.space) {
    const wsLimit = getMonthlyExecutionLimit(planId, seatCount);
    const wsExec = summaries.space.executions;
    const wsRatio = isFinite(wsLimit) ? wsExec / Math.max(wsLimit, 1) : 0;
    workspace = {
      scope: 'space',
      planId,
      planName: plan.jaName,
      executions: wsExec,
      limit: wsLimit,
      remaining: Math.max(wsLimit - wsExec, 0),
      ratio: Math.min(wsRatio, 1),
      cycle,
      daysUntilReset: daysUntilCycleReset(),
      inputTokens: summaries.space.input_tokens,
      outputTokens: summaries.space.output_tokens,
      costUsd: summaries.space.cost_usd,
      seatCount,
    };
  }

  return { personal, workspace };
}

export async function assertCanExecute(
  supabase: SupabaseClient,
  spaceId: string | null,
  userId: string,
): Promise<UsageCheckResult> {
  const usage = await getUsageInfo(supabase, spaceId, userId);
  const checkScope = usage.workspace ?? usage.personal;

  if (checkScope.executions >= checkScope.limit && isFinite(checkScope.limit)) {
    return {
      allowed: false,
      reason: 'over_monthly_limit',
      message: `今月の実行上限 (${checkScope.limit}回) に達しました。プランをアップグレードしてください。`,
      usage: checkScope,
    };
  }

  return { allowed: true, usage: checkScope };
}
