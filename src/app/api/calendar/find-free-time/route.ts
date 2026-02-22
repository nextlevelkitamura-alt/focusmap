import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { findFreeSlots, DEFAULT_WORKING_HOURS, type WorkingHours } from '@/lib/time-utils';
import { parseISO, startOfDay, endOfDay } from 'date-fns';

/**
 * 空き時間を検索
 * POST /api/calendar/find-free-time
 *
 * Body: {
 *   date: string,               // ISO 8601形式（日付）
 *   duration: number,           // 必要な時間（分単位）
 *   workingHours?: {            // 検索する時間帯（省略時は9:00-18:00）
 *     start: string,            // "09:00"
 *     end: string               // "18:00"
 *   }
 * }
 *
 * Response: {
 *   success: true,
 *   freeSlots: [
 *     {
 *       start: string,          // ISO 8601
 *       end: string,            // ISO 8601
 *       duration: number        // 分単位
 *     }
 *   ]
 * }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { date, duration, workingHours } = body;

    // バリデーション
    if (!date) {
      return NextResponse.json(
        { error: 'date is required' },
        { status: 400 }
      );
    }

    if (typeof duration !== 'number' || duration <= 0) {
      return NextResponse.json(
        { error: 'duration must be a positive number' },
        { status: 400 }
      );
    }

    // 作業時間帯のデフォルト値
    const hours: WorkingHours = workingHours || DEFAULT_WORKING_HOURS;

    // 検索対象の日付範囲
    const targetDate = parseISO(date);
    const dayStart = startOfDay(targetDate);
    const dayEnd = endOfDay(targetDate);

    // 既存のカレンダーイベントを取得
    const { data: events, error: eventsError } = await supabase
      .from('calendar_events')
      .select('start_time, end_time')
      .eq('user_id', user.id)
      .gte('start_time', dayStart.toISOString())
      .lte('start_time', dayEnd.toISOString());

    // スケジュール済みのタスクを取得（soft-delete済みを除外）
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('scheduled_at, estimated_time')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', dayStart.toISOString())
      .lte('scheduled_at', dayEnd.toISOString());

    if (eventsError) {
      console.error('[find-free-time] Events error:', eventsError);
    }

    if (tasksError) {
      console.error('[find-free-time] Tasks error:', tasksError);
    }

    // 既存の時間帯を統合
    const existingSlots = [
      ...(events || []).map(event => ({
        start: new Date(event.start_time),
        end: new Date(event.end_time)
      })),
      ...(tasks || []).map(task => {
        const startTime = new Date(task.scheduled_at!);
        const endTime = new Date(startTime.getTime() + task.estimated_time * 60 * 1000);
        return { start: startTime, end: endTime };
      })
    ];

    // 空き時間を検索
    const freeSlots = findFreeSlots(targetDate, existingSlots, duration, hours);

    return NextResponse.json({
      success: true,
      freeSlots: freeSlots.map(slot => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        duration: slot.duration
      }))
    });
  } catch (error: any) {
    console.error('[find-free-time] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to find free time' },
      { status: 500 }
    );
  }
}
