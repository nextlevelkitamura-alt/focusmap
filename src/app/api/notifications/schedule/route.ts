import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

function isMissingTableError(error: { code?: string; message?: string | null } | null): boolean {
  if (!error) return false;
  const message = error.message || '';
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === 'PGRST204' ||
    message.includes('does not exist') ||
    message.includes('Could not find the table')
  );
}

/**
 * 通知をスケジュール登録
 * POST /api/notifications/schedule
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const requestBody = await request.json();
    const {
      targetType,
      targetId,
      notificationType,
      scheduledAt,
      title,
      body,
      actionUrl,
    } = requestBody;

    // バリデーション
    if (!targetType || !targetId || !notificationType || !scheduledAt || !title || !body) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const validTargetTypes = ['task', 'event'];
    if (!validTargetTypes.includes(targetType)) {
      return NextResponse.json(
        { error: 'Invalid targetType' },
        { status: 400 }
      );
    }

    const validTypes = ['task_start', 'task_due', 'event_start'];
    if (!validTypes.includes(notificationType)) {
      return NextResponse.json(
        { error: 'Invalid notificationType' },
        { status: 400 }
      );
    }

    // 通知設定を確認
    const { data: setting, error: settingError } = await supabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', user.id)
      .eq('notification_type', notificationType)
      .single();

    // テーブル未作成等のエラーはスキップ
    if (settingError && isMissingTableError(settingError)) {
      console.warn('[notifications/schedule] notification_settings table not found, skipping');
      return NextResponse.json({ success: true, notificationId: null, skipped: true, reason: 'Table not found' });
    }

    // 通知が無効な場合はスキップ
    if (!setting || !setting.is_enabled) {
      return NextResponse.json({
        success: true,
        notificationId: null,
        skipped: true,
        reason: 'Notification is disabled',
      });
    }

    // 通知をキューに登録
    const { data: notification, error } = await supabase
      .from('notification_queue')
      .insert({
        user_id: user.id,
        target_type: targetType,
        target_id: targetId,
        notification_type: notificationType,
        title,
        body,
        action_url: actionUrl,
        scheduled_at: scheduledAt,
      })
      .select()
      .single();

    if (error) {
      if (isMissingTableError(error)) {
        console.warn('[notifications/schedule] notification_queue table not found, skipping');
        return NextResponse.json({ success: true, notificationId: null, skipped: true, reason: 'Table not found' });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      notificationId: notification.id,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Schedule notification error:', error);
    return NextResponse.json(
      { error: message || 'Failed to schedule notification' },
      { status: 500 }
    );
  }
}
