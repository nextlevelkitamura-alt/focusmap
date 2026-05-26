/**
 * Stripe SDK 初期化と定数定義
 *
 * 環境変数:
 *   - STRIPE_SECRET_KEY (server側、`sk_test_...` or `sk_live_...`)
 *   - STRIPE_WEBHOOK_SECRET (Webhook署名検証用)
 *   - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (client側、`pk_test_...`)
 *   - STRIPE_PRICE_PERSONAL_MONTHLY / STRIPE_PRICE_TEAM_MONTHLY (Price ID)
 */

import Stripe from 'stripe';
import type { PlanId } from '@/lib/plans';

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeInstance) return stripeInstance;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error('STRIPE_SECRET_KEY is not set. Add it to .env.local');
  }
  stripeInstance = new Stripe(secret, {
    // Stripe SDK の最新バージョンに自動追従させる
    apiVersion: '2026-04-22.dahlia',
    typescript: true,
  });
  return stripeInstance;
}

export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

export const STRIPE_PRICE_IDS: Partial<Record<PlanId, string>> = {
  personal: process.env.STRIPE_PRICE_PERSONAL_MONTHLY ?? '',
  team: process.env.STRIPE_PRICE_TEAM_MONTHLY ?? '',
};

export function priceIdForPlan(planId: PlanId): string | null {
  const priceId = STRIPE_PRICE_IDS[planId];
  return priceId && priceId.length > 0 ? priceId : null;
}

/** Stripe subscription status → Focusmap plan へのマッピング */
export function mapStripePlan(priceId: string | null | undefined): PlanId {
  if (!priceId) return 'free';
  if (priceId === STRIPE_PRICE_IDS.personal) return 'personal';
  if (priceId === STRIPE_PRICE_IDS.team) return 'team';
  return 'free';
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.length > 0);
}
