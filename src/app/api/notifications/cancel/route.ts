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
    const { data, error } = await supabase
      .from('notification_queue')
      .delete()
      .eq('user_id', user.id)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .eq('is_sent', false)
      .select();

    if (error) {
      // テーブル未作成の場合は警告のみでスキップ
      if (isMissingTableError(error)) {
        console.warn('[notifications/cancel] notification_queue table not found, skipping');
        return NextResponse.json({ success: true, canceledCount: 0 });
      }
      // RLSポリシー違反などの詳細なエラーログ
      console.error('[notifications/cancel] Database error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        userId: user.id,
        targetType,
        targetId,
      });
      throw error;
    }

    return NextResponse.json({
      success: true,
      canceledCount: data?.length || 0,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[notifications/cancel] Unexpected error:', {
      message,
      code,
      stack,
      userId: user?.id,
    });
    return NextResponse.json(
      {
        error: message || 'Failed to cancel notification',
        canceledCount: 0,
      },
      { status: 500 }
    );
  }
}
