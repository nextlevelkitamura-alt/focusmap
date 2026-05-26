import { NextRequest, NextResponse } from 'next/server';
import type { Stripe } from 'stripe';
import { getStripe, STRIPE_WEBHOOK_SECRET, mapStripePlan, isStripeConfigured } from '@/lib/stripe';
import { createServiceClient } from '@/utils/supabase/service';

export const runtime = 'nodejs';

/**
 * POST /api/stripe/webhook
 *
 * Stripe Webhook受信。subscription.* イベントで spaces.plan を更新する。
 * 設定: Stripe Dashboard で endpoint を `https://focusmap-official.com/api/stripe/webhook` に登録、
 *      署名secret を STRIPE_WEBHOOK_SECRET に設定。
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured() || !STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const spaceId = (session.metadata as Record<string, string> | null | undefined)?.space_id;
        if (spaceId && session.subscription && typeof session.subscription === 'string') {
          await supabase
            .from('spaces')
            .update({ billing_subscription_id: session.subscription })
            .eq('id', spaceId);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const priceId = sub.items.data[0]?.price?.id ?? null;
        const plan = mapStripePlan(priceId);
        const seatCount = Math.max(1, Number(sub.items.data[0]?.quantity ?? 1));
        const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end ?? null;

        await supabase
          .from('spaces')
          .update({
            plan,
            seat_count: seatCount,
            billing_subscription_id: sub.id,
            billing_current_period_end: periodEnd
              ? new Date(periodEnd * 1000).toISOString()
              : null,
          })
          .eq('billing_customer_id', customerId);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        await supabase
          .from('spaces')
          .update({
            plan: 'free',
            billing_subscription_id: null,
            billing_current_period_end: null,
            seat_count: 1,
          })
          .eq('billing_customer_id', customerId);
        break;
      }

      default:
        // 他のイベントは無視
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error', err);
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
