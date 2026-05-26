import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe';

/**
 * POST /api/stripe/portal
 *
 * Body: { space_id: string }
 * Returns: { url: string } — Customer Portal session URL
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
  if (!spaceId) return NextResponse.json({ error: 'space_id is required' }, { status: 400 });

  const { data: canOwn } = await supabase.rpc('can_own_space', {
    p_space_id: spaceId,
    p_user_id: user.id,
  });
  if (!canOwn) {
    return NextResponse.json({ error: 'Only the workspace owner can manage billing' }, { status: 403 });
  }

  const { data: spaceRow } = await supabase
    .from('spaces')
    .select('billing_customer_id')
    .eq('id', spaceId)
    .maybeSingle();

  if (!spaceRow?.billing_customer_id) {
    return NextResponse.json(
      { error: 'No Stripe customer for this workspace yet. Start a checkout first.' },
      { status: 400 },
    );
  }

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://focusmap-official.com';

  const session = await getStripe().billingPortal.sessions.create({
    customer: spaceRow.billing_customer_id,
    return_url: `${origin}/dashboard/workspace/billing`,
  });

  return NextResponse.json({ url: session.url });
}
