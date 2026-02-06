import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * タスクの所要時間を設定
 * PATCH /api/tasks/:id/time
 *
 * Body: {
 *   estimatedDuration: number  // 分単位
 * }
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
    const taskId = params.id;
    const body = await request.json();
    const { estimatedDuration } = body;

    // バリデーション
    if (typeof estimatedDuration !== 'number' || estimatedDuration < 0) {
      return NextResponse.json(
        { error: 'estimatedDuration must be a non-negative number' },
        { status: 400 }
      );
    }

    // タスクを取得
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // estimated_time を更新
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        estimated_time: estimatedDuration,
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('[time] Update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update task time' },
        { status: 500 }
      );
    }

    // 更新後のタスクを取得
    const { data: updatedTask } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    return NextResponse.json({
      success: true,
      task: updatedTask
    });
  } catch (error: any) {
    console.error('[time] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update task time' },
      { status: 500 }
    );
  }
}
