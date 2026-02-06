import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * Initialize default notification settings for a user
 * POST /api/notifications/initialize
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Check if settings already exist
    const { data: existingSettings } = await supabase
      .from('notification_settings')
      .select('id')
      .eq('user_id', user.id);

    if (existingSettings && existingSettings.length > 0) {
      return NextResponse.json({
        success: true,
        message: 'Notification settings already exist',
        count: existingSettings.length,
      });
    }

    // Insert default settings
    const { data, error } = await supabase
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

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Default notification settings created',
      settings: data,
    });
  } catch (error: any) {
    console.error('Initialize notification settings error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to initialize notification settings' },
      { status: 500 }
    );
  }
}
