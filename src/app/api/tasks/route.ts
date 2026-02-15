import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * タスクを新規作成
 * POST /api/tasks
 *
 * ボディ:
 *   id: タスクID（クライアントで生成したUUID、楽観的UI用）
 *   group_id: タスクグループID（必須）
 *   parent_task_id: 親タスクID（オプション）
 *   title: タイトル（必須）
 *   order_index: 表示順（オプション、デフォルト0）
 */
export async function POST(request: NextRequest) {
  console.log('[tasks/create] API called');
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.log('[tasks/create] Unauthorized');
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  console.log('[tasks/create] User authenticated:', user.id);

  try {
    const body = await request.json();
    const { id, group_id, parent_task_id, title, order_index } = body;
    const titleValue = (typeof title === 'string' && title.trim()) || 'New Task';

    if (!group_id) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'group_id is required'
          }
        },
        { status: 400 }
      );
    }

    // group_id が実際に存在するか確認
    const { data: group, error: groupError } = await supabase
      .from('task_groups')
      .select('id')
      .eq('id', group_id)
      .eq('user_id', user.id)
      .single();

    if (groupError || !group) {
      console.error('[tasks/create] Group not found:', { group_id, error: groupError });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'GROUP_NOT_FOUND',
            message: `Task group not found: ${group_id}`
          }
        },
        { status: 404 }
      );
    }

    // parent_task_id が指定されていて存在しない場合はエラー
    if (parent_task_id) {
      const { data: parentTask, error: parentError } = await supabase
        .from('tasks')
        .select('id')
        .eq('id', parent_task_id)
        .eq('user_id', user.id)
        .single();

      if (parentError || !parentTask) {
        console.error('[tasks/create] Parent task not found:', { parent_task_id, error: parentError });
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'PARENT_NOT_FOUND',
              message: `Parent task not found: ${parent_task_id}`
            }
          },
          { status: 404 }
        );
      }
    }

    // INSERT
    const insertPayload: Record<string, unknown> = {
      user_id: user.id,
      group_id,
      parent_task_id: parent_task_id || null,
      title: titleValue,
      status: 'todo',
      order_index: order_index ?? 0,
      actual_time_minutes: 0,
      estimated_time: 0,
    };

    // クライアントが ID を指定した場合はそれを使用（楽観的UI用）
    if (id) {
      insertPayload.id = id;
    }

    console.log('[tasks/create] Inserting task:', insertPayload);

    // INSERT と SELECT を分離（.select().single() チェーンが失敗する場合に備え）
    const { error: insertError } = await supabase
      .from('tasks')
      .insert(insertPayload);

    if (insertError) {
      console.error('[tasks/create] INSERT failed:', {
        code: insertError.code,
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
      });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: insertError.code || 'INSERT_ERROR',
            message: insertError.message || 'Failed to create task',
            details: insertError.details,
            hint: insertError.hint,
          }
        },
        { status: 500 }
      );
    }

    // INSERT 成功 → 作成されたタスクを SELECT
    const taskId = id || insertPayload.id;
    const { data: task, error: selectError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (selectError) {
      console.warn('[tasks/create] SELECT after INSERT failed:', selectError);
      // INSERT は成功しているので、最低限の情報を返す
      return NextResponse.json({
        success: true,
        task: { ...insertPayload, created_at: new Date().toISOString() },
      });
    }

    console.log('[tasks/create] Task created successfully:', task.id);

    return NextResponse.json({
      success: true,
      task,
    });

  } catch (error: any) {
    console.error('[tasks/create] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error.message || 'Failed to create task'
        }
      },
      { status: 500 }
    );
  }
}
