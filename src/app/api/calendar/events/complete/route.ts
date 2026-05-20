import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * カレンダーイベントの完了状態を更新
 * PATCH /api/calendar/events/complete
 * body: { google_event_id: string, calendar_id?: string, completed_date?: string, is_completed: boolean }
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
  let calendar_id: string | undefined;
  let completed_date: string | undefined;
  let start_time: string | undefined;
  let is_completed: boolean;
  try {
    const body = await request.json();
    google_event_id = body.google_event_id;
    calendar_id = body.calendar_id;
    completed_date = body.completed_date;
    start_time = body.start_time;
    is_completed = !!body.is_completed;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!google_event_id) {
    return NextResponse.json({ success: false, error: 'google_event_id is required' }, { status: 400 });
  }

  const normalizedCompletedDate = normalizeDateString(completed_date || start_time);
  if (!normalizedCompletedDate) {
    return NextResponse.json({ success: false, error: 'completed_date must be YYYY-MM-DD or a valid date' }, { status: 400 });
  }

  let updateQuery = supabase
    .from('calendar_events')
    .update({ is_completed })
    .eq('user_id', user.id)
    .eq('google_event_id', google_event_id);

  if (calendar_id) {
    updateQuery = updateQuery.eq('calendar_id', calendar_id);
  }

  const updateResult = await updateQuery.select('id, calendar_id');
  let updatedRows = updateResult.data;
  const error = updateResult.error;

  if (error) {
    console.error('[events/complete] Update failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // メモ由来の予定は ideal_goals 側に calendar_id を保持していないため、
  // クライアントが送った calendar_id が現在の保存先とずれることがある。
  // その場合も google_event_id を正として実レコードを更新する。
  if (calendar_id && (!updatedRows || updatedRows.length === 0)) {
    const retry = await supabase
      .from('calendar_events')
      .update({ is_completed })
      .eq('user_id', user.id)
      .eq('google_event_id', google_event_id)
      .select('id, calendar_id');

    if (retry.error) {
      console.error('[events/complete] Retry update failed:', retry.error);
      return NextResponse.json({ success: false, error: retry.error.message }, { status: 500 });
    }

    updatedRows = retry.data;
  }

  const completionCalendarId = updatedRows?.[0]?.calendar_id || calendar_id;

  if (is_completed) {
    if (!completionCalendarId) {
      console.warn('[events/complete] Missing calendar_id for completion upsert:', { google_event_id });
      return NextResponse.json({ success: false, error: 'calendar_id is required when completing an uncached event' }, { status: 400 });
    }

    const { error: completionError } = await supabase
      .from('event_completions')
      .upsert({
        user_id: user.id,
        google_event_id,
        calendar_id: completionCalendarId,
        completed_date: normalizedCompletedDate,
      }, {
        onConflict: 'user_id,google_event_id,completed_date',
      });

    if (completionError) {
      console.error('[events/complete] Completion upsert failed:', completionError);
      return NextResponse.json({ success: false, error: completionError.message }, { status: 500 });
    }
  } else {
    const completionDeleteQuery = supabase
      .from('event_completions')
      .delete()
      .eq('user_id', user.id)
      .eq('google_event_id', google_event_id)
      .eq('completed_date', normalizedCompletedDate);

    const { error: completionError } = await completionDeleteQuery;

    if (completionError) {
      console.error('[events/complete] Completion delete failed:', completionError);
      return NextResponse.json({ success: false, error: completionError.message }, { status: 500 });
    }
  }

  if (!updatedRows || updatedRows.length === 0) {
    console.warn('[events/complete] No calendar_events row matched; saved completion sidecar only:', {
      google_event_id,
      calendar_id: completionCalendarId,
      completed_date: normalizedCompletedDate,
      is_completed,
    });
  }

  console.log('[events/complete] Updated is_completed:', {
    google_event_id,
    calendar_id: completionCalendarId,
    completed_date: normalizedCompletedDate,
    is_completed,
    rows: updatedRows?.length || 0,
  });
  return NextResponse.json({ success: true });
}

function normalizeDateString(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = typeof value === 'string' || value instanceof Date
    ? new Date(value)
    : new Date();

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
}
