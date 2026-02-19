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
    const { id, group_id, project_id, parent_task_id, title, order_index, scheduled_at, estimated_time, calendar_id, priority } = body;
    const titleValue = (typeof title === 'string' && title.trim()) || 'New Task';

    // title バリデーション
    if (!title || (typeof title === 'string' && !title.trim())) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'title is required'
          }
        },
        { status: 400 }
      );
    }

    // Note: parent_task_id は null 可（クイックタスク＝ルートレベル）
    // 親タスクの存在チェックはDB制約に委任
    // 楽観的UIで作成された親タスクがまだDB未同期の場合があるため、
    // ここでの厳格なチェックは行わない

    // INSERT
    const insertPayload: Record<string, unknown> = {
      user_id: user.id,
      group_id: group_id || null, // 後方互換性のため残す（Phase 3で削除）
      project_id: project_id || null,
      parent_task_id: parent_task_id || null,
      title: titleValue,
      status: 'todo',
      order_index: order_index ?? 0,
      actual_time_minutes: 0,
      estimated_time: estimated_time ?? 0,
      scheduled_at: scheduled_at || null,
      calendar_id: calendar_id || null,
      priority: priority ?? null,
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
