import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import type { NotificationSetting } from '@/types/calendar';

/**
 * 通知設定を取得
 * GET /api/notifications/settings
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data: settings, error } = await supabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', user.id);

    if (error) throw error;

    // If no settings exist, initialize defaults
    if (!settings || settings.length === 0) {
      const { data: newSettings, error: insertError } = await supabase
        .from('notification_settings')
        .insert([
          {
            user_id: user.id,
            notification_type: 'task_start',
            advance_minutes: 15,
            is_enabled: true,
            sound_enabled: true,
            email_enabled: false,
          },
          {
            user_id: user.id,
            notification_type: 'task_due',
            advance_minutes: 60,
            is_enabled: true,
            sound_enabled: true,
            email_enabled: false,
          },
          {
            user_id: user.id,
            notification_type: 'event_start',
            advance_minutes: 15,
            is_enabled: true,
            sound_enabled: true,
            email_enabled: false,
          },
        ])
        .select();

      if (insertError) throw insertError;

      return NextResponse.json({
        success: true,
        settings: newSettings || [],
      });
    }

    return NextResponse.json({
      success: true,
      settings: settings || [],
    });
  } catch (error: any) {
    console.error('Get notification settings error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get notification settings' },
      { status: 500 }
    );
  }
}

/**
 * 通知設定を更新
 * PATCH /api/notifications/settings
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { notificationType, isEnabled, advanceMinutes, soundEnabled, emailEnabled } = body;

    if (!notificationType) {
      return NextResponse.json(
        { error: 'notificationType is required' },
        { status: 400 }
      );
    }

    // バリデーション
    const validTypes = ['task_start', 'task_due', 'event_start'];
    if (!validTypes.includes(notificationType)) {
      return NextResponse.json(
        { error: 'Invalid notificationType' },
        { status: 400 }
      );
    }

    const validMinutes = [5, 15, 30, 60, 1440];
    if (advanceMinutes !== undefined && !validMinutes.includes(advanceMinutes)) {
      return NextResponse.json(
        { error: 'Invalid advanceMinutes' },
        { status: 400 }
      );
    }

    // 更新データの構築
    const updateData: Partial<NotificationSetting> = {};
    if (isEnabled !== undefined) updateData.is_enabled = isEnabled;
    if (advanceMinutes !== undefined) updateData.advance_minutes = advanceMinutes;
    if (soundEnabled !== undefined) updateData.sound_enabled = soundEnabled;
    if (emailEnabled !== undefined) updateData.email_enabled = emailEnabled;

    // 設定を更新または作成
    const { data: setting, error } = await supabase
      .from('notification_settings')
      .upsert({
        user_id: user.id,
        notification_type: notificationType,
        ...updateData,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      setting: {
        id: setting.id,
        notificationType: setting.notification_type,
        isEnabled: setting.is_enabled,
        advanceMinutes: setting.advance_minutes,
        soundEnabled: setting.sound_enabled,
        emailEnabled: setting.email_enabled,
      },
    });
  } catch (error: any) {
    console.error('Update notification settings error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update notification settings' },
      { status: 500 }
    );
  }
}
