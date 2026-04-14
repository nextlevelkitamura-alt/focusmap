import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * カレンダーイベントの完了状態を更新
 * PATCH /api/calendar/events/complete
 * body: { google_event_id: string, is_completed: boolean }
 *
 * ブラウザ Supabase クライアント経由では RLS/型の問題が発生するため、
 * サーバー側で認証・更新を行う。
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let google_event_id: string | undefined;
  let is_completed: boolean;
  try {
    const body = await request.json();
    google_event_id = body.google_event_id;
    is_completed = !!body.is_completed;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!google_event_id) {
    return NextResponse.json({ success: false, error: 'google_event_id is required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('calendar_events')
    .update({ is_completed })
    .eq('user_id', user.id)
    .eq('google_event_id', google_event_id);

  if (error) {
    console.error('[events/complete] Update failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  console.log('[events/complete] Updated is_completed:', { google_event_id, is_completed });
  return NextResponse.json({ success: true });
}
