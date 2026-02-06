import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * 通知をキャンセル
 * DELETE /api/notifications/cancel
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  // ログインユーザーを確認
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { targetType, targetId } = body;

    // バリデーション
    if (!targetType || !targetId) {
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

    // 通知を削除（まだ送信されていないもののみ）
    const { data, error, count } = await supabase
      .from('notification_queue')
      .delete()
      .eq('user_id', user.id)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .eq('is_sent', false)
      .select();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      canceledCount: count || 0,
    });
  } catch (error: any) {
    console.error('Cancel notification error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to cancel notification' },
      { status: 500 }
    );
  }
}
