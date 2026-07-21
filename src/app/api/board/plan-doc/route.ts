import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getPlanStepDoc } from '@/lib/turso/plan-links';

// 子06: 工程行の📄ビューア用。工程の計画slug・NN子番号・kind から plan_docs.body を1本引いて返す（表示専用）。
// ボード本体の payload を太らせないため、📄タップ時に遅延取得する（board/summary には body を載せない）。
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug') ?? '';
  const nn = searchParams.get('nn') ?? '';
  const kind = searchParams.get('kind') ?? '';
  if (!slug) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'slug is required' } },
      { status: 400 },
    );
  }

  try {
    const doc = await getPlanStepDoc(slug, nn, kind);
    return NextResponse.json({ success: true, doc });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load plan doc';
    return NextResponse.json({ success: false, error: { code: 'API_ERROR', message } }, { status: 500 });
  }
}
