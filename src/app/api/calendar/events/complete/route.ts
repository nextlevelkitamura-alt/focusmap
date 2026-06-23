import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type EventCompletionPayload = {
  user_id: string;
  google_event_id: string;
  calendar_id: string;
  completed_date: string;
};

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

  // Legacy callers might omit calendar_id. Only then fall back to google_event_id
  // alone; when a calendar_id is supplied, keep completion scoped to that calendar.
  if (!calendar_id && (!updatedRows || updatedRows.length === 0)) {
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

    const completionError = await upsertEventCompletion(supabase, {
      user_id: user.id,
      google_event_id,
      calendar_id: completionCalendarId,
      completed_date: normalizedCompletedDate,
    });

    if (completionError) {
      console.error('[events/complete] Completion upsert failed:', completionError);
      return NextResponse.json({ success: false, error: getSupabaseErrorMessage(completionError) }, { status: 500 });
    }
  } else {
    let completionDeleteQuery = supabase
      .from('event_completions')
      .delete()
      .eq('user_id', user.id)
      .eq('google_event_id', google_event_id)
      .eq('completed_date', normalizedCompletedDate);

    if (completionCalendarId) {
      completionDeleteQuery = completionDeleteQuery.eq('calendar_id', completionCalendarId);
    }

    const { error: completionError } = await completionDeleteQuery;

    if (completionError) {
      console.error('[events/complete] Completion delete failed:', completionError);
      return NextResponse.json({ success: false, error: completionError.message }, { status: 500 });
    }
  }

  if (completionCalendarId) {
    await syncImportedGoogleEventTaskCompletion(
      supabase,
      user.id,
      google_event_id,
      completionCalendarId,
      is_completed,
    );
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

async function upsertEventCompletion(
  supabase: SupabaseClient,
  payload: EventCompletionPayload,
): Promise<SupabaseErrorLike | null> {
  const { error } = await supabase
    .from('event_completions')
    .upsert(payload, {
      onConflict: 'user_id,calendar_id,google_event_id,completed_date',
    });

  if (!error) return null;
  if (!isMissingCompositeConflictError(error)) return error;

  console.warn('[events/complete] Composite event_completions conflict target missing; falling back to delete/insert', {
    google_event_id: payload.google_event_id,
    calendar_id: payload.calendar_id,
    completed_date: payload.completed_date,
    code: error.code,
    message: error.message,
  });

  // Some deployed databases may still have the legacy unique constraint
  // user_id + google_event_id + completed_date. Delete by that legacy key first
  // so insert can persist completion instead of surfacing a save failure.
  const deleteResult = await supabase
    .from('event_completions')
    .delete()
    .eq('user_id', payload.user_id)
    .eq('google_event_id', payload.google_event_id)
    .eq('completed_date', payload.completed_date);

  if (deleteResult.error) return deleteResult.error;

  const insertResult = await supabase
    .from('event_completions')
    .insert(payload);

  return insertResult.error ?? null;
}

async function syncImportedGoogleEventTaskCompletion(
  supabase: SupabaseClient,
  userId: string,
  googleEventId: string,
  calendarId: string,
  isCompleted: boolean,
) {
  const updates = isCompleted
    ? { status: 'done', stage: 'done' }
    : { status: 'todo', stage: 'scheduled' };

  const { error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('user_id', userId)
    .eq('source', 'google_event')
    .eq('google_event_id', googleEventId)
    .eq('calendar_id', calendarId)
    .is('deleted_at', null);

  if (error) {
    console.error('[events/complete] Failed to sync imported Google event task completion:', {
      error,
      googleEventId,
      calendarId,
      isCompleted,
    });
  }
}

function getSupabaseErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Failed to save event completion';
}

function isMissingCompositeConflictError(error: SupabaseErrorLike): boolean {
  const message = error.message ?? '';
  return error.code === '42P10' ||
    message.includes('no unique or exclusion constraint matching the ON CONFLICT specification') ||
    message.includes('there is no unique or exclusion constraint matching the ON CONFLICT specification');
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
