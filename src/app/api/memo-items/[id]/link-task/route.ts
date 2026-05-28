import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

type RouteContext = {
  params: Promise<{ id: string }>
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest, context: RouteContext) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params
  const body = await request.json().catch(() => ({}))

  const { data: item, error: itemError } = await supabase
    .from('memo_items')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (itemError || !item) return NextResponse.json({ error: 'メモ項目が見つかりません' }, { status: 404 })

  const { data: existingLink } = await supabase
    .from('memo_node_links')
    .select('*, tasks(*)')
    .eq('user_id', user.id)
    .eq('memo_item_id', item.id)
    .eq('link_type', 'mindmap_node')
    .eq('status', 'active')
    .maybeSingle()

  if (existingLink) {
    return NextResponse.json({
      link: existingLink,
      task: Array.isArray(existingLink.tasks) ? existingLink.tasks[0] : existingLink.tasks,
      reused: true,
      reason: 'このメモ項目はすでにマインドマップへ投入済みです',
    })
  }

  const existingTaskId = text(body.task_id)
  let projectId = text(body.project_id) || item.project_id
  const parentTaskId = body.parent_task_id === null ? null : (text(body.parent_task_id) || null)
  const title = text(body.title) || item.title
  const memo = text(body.memo) || item.body || null
  const itemIsCompleted = item.status === 'done'

  if (!projectId && !existingTaskId) {
    return NextResponse.json({ error: 'マインドマップに投入するには project_id が必要です' }, { status: 400 })
  }

  let taskId = existingTaskId
  let task: unknown = null

  if (existingTaskId) {
    const { data: existingTask, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', existingTaskId)
      .eq('user_id', user.id)
      .single()
    if (taskError || !existingTask) return NextResponse.json({ error: 'リンク先タスクが見つかりません' }, { status: 404 })
    task = existingTask
    projectId = existingTask.project_id ?? projectId
  } else {
    let orderQuery = supabase
      .from('tasks')
      .select('order_index')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .order('order_index', { ascending: false })
      .limit(1)

    orderQuery = parentTaskId
      ? orderQuery.eq('parent_task_id', parentTaskId)
      : orderQuery.is('parent_task_id', null)

    const { data: lastRows } = await orderQuery
    const nextOrderIndex = (lastRows?.[0]?.order_index ?? -1) + 1

    const { data: createdTask, error: createError } = await supabase
      .from('tasks')
      .insert({
        user_id: user.id,
        project_id: projectId,
        parent_task_id: parentTaskId,
        is_group: parentTaskId ? false : item.item_kind === 'summary' || item.item_kind === 'theme',
        title,
        memo,
        status: itemIsCompleted ? 'done' : 'todo',
        stage: itemIsCompleted ? 'done' : 'plan',
        source: item.source_type === 'wishlist' ? 'wishlist' : 'memo',
        order_index: nextOrderIndex,
        estimated_time: typeof body.estimated_time === 'number' ? body.estimated_time : 0,
        actual_time_minutes: 0,
        priority: typeof body.priority === 'number' ? body.priority : null,
      })
      .select('*')
      .single()

    if (createError) return NextResponse.json({ error: createError.message }, { status: 500 })
    taskId = createdTask.id
    task = createdTask
  }

  const { data: link, error: linkError } = await supabase
    .from('memo_node_links')
    .insert({
      user_id: user.id,
      memo_item_id: item.id,
      source_type: item.source_type,
      source_id: item.source_id,
      task_id: taskId,
      project_id: projectId,
      link_type: 'mindmap_node',
      status: 'active',
      created_from_run_id: item.structure_run_id,
      metadata: {
        title_at_link: title,
        linked_by: existingTaskId ? 'existing_task' : parentTaskId ? 'created_child_task' : 'created_root_task',
        placement_mode: existingTaskId ? 'link_existing' : parentTaskId ? 'create_child' : 'root',
      },
    })
    .select('*')
    .single()

  if (linkError) {
    if (linkError.code === '23505') {
      const { data: duplicateLink } = await supabase
        .from('memo_node_links')
        .select('*, tasks(*)')
        .eq('user_id', user.id)
        .eq('memo_item_id', item.id)
        .eq('link_type', 'mindmap_node')
        .eq('status', 'active')
        .maybeSingle()
      return NextResponse.json({ link: duplicateLink, reused: true })
    }
    return NextResponse.json({ error: linkError.message }, { status: 500 })
  }

  const linkedTask = task && typeof task === 'object' ? task as { status?: unknown; scheduled_at?: unknown } : null
  const linkedTaskDone = linkedTask?.status === 'done'
  const linkedMemoItemStatus = linkedTaskDone ? 'done' : (body.scheduled_at ? 'scheduled' : 'task')

  await supabase
    .from('memo_items')
    .update({ status: linkedMemoItemStatus, project_id: projectId })
    .eq('id', item.id)
    .eq('user_id', user.id)

  if (item.source_type === 'wishlist') {
    await supabase
      .from('ideal_goals')
      .update({
        project_id: projectId,
        is_completed: linkedTaskDone,
        memo_status: linkedTaskDone ? 'completed' : 'organized',
        ...(linkedTaskDone ? { is_today: false } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.source_id)
      .eq('user_id', user.id)
  }

  return NextResponse.json({ link, task, reused: false }, { status: 201 })
}
