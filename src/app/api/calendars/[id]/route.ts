import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * カレンダーの表示/非表示を切り替え
 * PATCH /api/calendars/:id
 *
 * Request Body:
 *   {
 *     selected: boolean
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     calendar: { id, selected }
 *   }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const calendarId = params.id;
    const body = await request.json();
    const { selected } = body;

    if (typeof selected !== 'boolean') {
      return NextResponse.json(
        { error: 'selected must be a boolean' },
        { status: 400 }
      );
    }

    // カレンダーの所有権限を確認
    const { data: calendar, error: calendarError } = await supabase
      .from('user_calendars')
      .select('*')
      .eq('id', calendarId)
      .eq('user_id', user.id)
      .single();

    if (calendarError || !calendar) {
      return NextResponse.json(
        { error: 'Calendar not found' },
        { status: 404 }
      );
    }

    // 選択状態を更新
    const { error: updateError } = await supabase
      .from('user_calendars')
      .update({
        selected,
        updated_at: new Date().toISOString()
      })
      .eq('id', calendarId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('[calendar/:id] Update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update calendar' },
        { status: 500 }
      );
    }

    // 更新後のカレンダーを取得
    const { data: updatedCalendar } = await supabase
      .from('user_calendars')
      .select('*')
      .eq('id', calendarId)
      .single();

    return NextResponse.json({
      success: true,
      calendar: {
        id: updatedCalendar.id,
        selected: updatedCalendar.selected
      }
    });
  } catch (error: any) {
    console.error('[calendar/:id] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update calendar' },
      { status: 500 }
    );
  }
}
