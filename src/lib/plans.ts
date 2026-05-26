/**
 * Focusmap SaaSプラン定義
 *
 * 詳細: docs/plans/saas-design-api-billing.md / saas-design-buyer-user.md
 */

export type PlanId = 'free' | 'personal' | 'team' | 'enterprise';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  jaName: string;
  priceUsdPerSeat: number;
  priceJpyPerSeat: number;
  minSeats: number;
  monthlyExecutionsPerSeat: number;
  minExecutionIntervalSec: number;
  overageUsdPerExecution: number | null;
  features: {
    macMiniSupport: boolean;
    teamSharing: boolean;
    adminDashboard: boolean;
    auditLog: boolean;
    sso: boolean;
    byok: boolean;
    prioritySupport: boolean;
  };
  description: string;
}

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    jaName: '無料プラン',
    priceUsdPerSeat: 0,
    priceJpyPerSeat: 0,
    minSeats: 1,
    monthlyExecutionsPerSeat: 5,
    minExecutionIntervalSec: 900,
    overageUsdPerExecution: null,
    features: {
      macMiniSupport: false,
      teamSharing: false,
      adminDashboard: false,
      auditLog: false,
      sso: false,
      byok: false,
      prioritySupport: false,
    },
    description: '試用枠 — 自動化を1つ味見できる',
  },
  personal: {
    id: 'personal',
    name: 'Personal',
    jaName: '個人プラン',
    priceUsdPerSeat: 19,
    priceJpyPerSeat: 2980,
    minSeats: 1,
    monthlyExecutionsPerSeat: 100,
    minExecutionIntervalSec: 300,
    overageUsdPerExecution: 0.2,
    features: {
      macMiniSupport: true,
      teamSharing: false,
      adminDashboard: false,
      auditLog: false,
      sso: false,
      byok: false,
      prioritySupport: false,
    },
    description: '個人事業主・フリーランス向け',
  },
  team: {
    id: 'team',
    name: 'Team',
    jaName: 'チームプラン',
    priceUsdPerSeat: 39,
    priceJpyPerSeat: 5980,
    minSeats: 3,
    monthlyExecutionsPerSeat: 500,
    minExecutionIntervalSec: 60,
    overageUsdPerExecution: 0.1,
    features: {
      macMiniSupport: true,
      teamSharing: true,
      adminDashboard: true,
      auditLog: true,
      sso: false,
      byok: false,
      prioritySupport: true,
    },
    description: '小規模法人向け (最低3 seat)',
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    jaName: 'エンタープライズ',
    priceUsdPerSeat: 0,
    priceJpyPerSeat: 0,
    minSeats: 1,
    monthlyExecutionsPerSeat: Number.POSITIVE_INFINITY,
    minExecutionIntervalSec: 0,
    overageUsdPerExecution: null,
    features: {
      macMiniSupport: true,
      teamSharing: true,
      adminDashboard: true,
      auditLog: true,
      sso: true,
      byok: true,
      prioritySupport: true,
    },
    description: '個別契約 — SSO / BYOK / 監査ログ完備',
  },
};

export function getPlan(planId: string | null | undefined): PlanDefinition {
  if (!planId) return PLAN_DEFINITIONS.free;
  return (PLAN_DEFINITIONS as Record<string, PlanDefinition>)[planId] ?? PLAN_DEFINITIONS.free;
}

export function getMonthlyExecutionLimit(planId: PlanId | string, seatCount = 1): number {
  const plan = getPlan(planId);
  if (!isFinite(plan.monthlyExecutionsPerSeat)) return Number.POSITIVE_INFINITY;
  return plan.monthlyExecutionsPerSeat * Math.max(seatCount, plan.minSeats);
}

export function getPlanTotalPriceUsd(planId: PlanId | string, seatCount = 1): number {
  const plan = getPlan(planId);
  return plan.priceUsdPerSeat * Math.max(seatCount, plan.minSeats);
}

export function getPlanTotalPriceJpy(planId: PlanId | string, seatCount = 1): number {
  const plan = getPlan(planId);
  return plan.priceJpyPerSeat * Math.max(seatCount, plan.minSeats);
}

export const PLAN_ORDER: PlanId[] = ['free', 'personal', 'team', 'enterprise'];

export function isPlanUpgrade(from: PlanId | string, to: PlanId | string): boolean {
  return PLAN_ORDER.indexOf(to as PlanId) > PLAN_ORDER.indexOf(from as PlanId);
}
