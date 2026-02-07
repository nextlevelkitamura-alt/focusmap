import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * Google カレンダー連携を解除
 * POST /api/calendar/disconnect
 */
export async function POST() {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // トークンを削除（NULLに設定）
    // Note: calendarsカラムはマイグレーション後に追加されるため、
    // 既存のカラムのみ更新する
    const { error: updateError } = await supabase
      .from('user_calendar_settings')
      .update({
        google_access_token: null,
        google_refresh_token: null,
        google_token_expires_at: null,
        is_sync_enabled: false,
        sync_status: 'disconnected',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      message: 'Google Calendar disconnected successfully'
    });

  } catch (error: any) {
    console.error('Disconnect calendar error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to disconnect calendar' },
      { status: 500 }
    );
  }
}
