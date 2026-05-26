import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getStripe, isStripeConfigured, priceIdForPlan } from '@/lib/stripe';
import type { PlanId } from '@/lib/plans';
import { PLAN_DEFINITIONS } from '@/lib/plans';

/**
 * POST /api/stripe/checkout
 *
 * Body: { space_id: string, plan: 'personal' | 'team', seats?: number }
 * Returns: { url: string } — Stripe Checkout Session URL
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: 'Stripe is not configured. Set STRIPE_SECRET_KEY in .env.local' },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const spaceId: string | undefined = body.space_id;
  const plan: PlanId | undefined = body.plan;
  const seats: number = Math.max(1, Number(body.seats ?? 1));

  if (!spaceId) return NextResponse.json({ error: 'space_id is required' }, { status: 400 });
  if (!plan || !['personal', 'team'].includes(plan)) {
    return NextResponse.json({ error: 'plan must be personal or team' }, { status: 400 });
  }

  // Space オーナーチェック
  const { data: canOwn } = await supabase.rpc('can_own_space', {
    p_space_id: spaceId,
    p_user_id: user.id,
  });
  if (!canOwn) {
    return NextResponse.json(
      { error: 'Only the workspace owner can change billing' },
      { status: 403 },
    );
  }

  const priceId = priceIdForPlan(plan);
  if (!priceId) {
    return NextResponse.json(
      { error: `Price ID for plan "${plan}" is not configured` },
      { status: 503 },
    );
  }

  const planDef = PLAN_DEFINITIONS[plan];
  const quantity = Math.max(seats, planDef.minSeats);

  // 既存の Stripe Customer を取得 or 新規作成
  const { data: spaceRow } = await supabase
    .from('spaces')
    .select('id, title, billing_customer_id')
    .eq('id', spaceId)
    .maybeSingle();

  const stripe = getStripe();
  let customerId = spaceRow?.billing_customer_id ?? null;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: spaceRow?.title ?? user.email ?? 'Focusmap Workspace',
      metadata: {
        space_id: spaceId,
        user_id: user.id,
      },
    });
    customerId = customer.id;
    await supabase
      .from('spaces')
      .update({ billing_customer_id: customerId })
      .eq('id', spaceId);
  }

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://focusmap-official.com';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity,
      },
    ],
    subscription_data: {
      metadata: {
        space_id: spaceId,
        plan,
      },
    },
    success_url: `${origin}/dashboard/workspace/billing?checkout=success`,
    cancel_url: `${origin}/dashboard/workspace/billing?checkout=cancelled`,
    allow_promotion_codes: true,
    automatic_tax: { enabled: true },
  });

  return NextResponse.json({ url: session.url });
}
