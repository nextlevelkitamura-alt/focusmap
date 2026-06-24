import { NextRequest, NextResponse } from 'next/server'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  getAiHistoryItemForUser,
  setAiHistorySourceTaskIdForUser,
  toAiHistoryListItem,
} from '@/lib/turso/ai-history'
import { authenticateAiHistoryRequest, compactString, unauthorized } from '../../_shared'
import type { Task } from '@/types/database'

type RouteContext = {
  params: Promise<{ id: string }>
}

type PlacementPosition = 'above' | 'below' | 'as-child'
type AiHistoryAuth = NonNullable<Awaited<ReturnType<typeof authenticateAiHistoryRequest>>>

function parsePosition(value: unknown): PlacementPosition {
  return value === 'above' || value === 'below' || value === 'as-child' ? value : 'as-child'
}

function displayStatus(status: string | null | undefined) {
  return status === 'completed' ? 'done' : status || null
}

function memoFromAiHistory(item: Awaited<ReturnType<typeof getAiHistoryItemForUser>>) {
  if (!item) return null
  const lines = [
    `## ${item.title}`,
    '',
    item.snippet?.trim() || null,
    '',
    item.provider === 'codex_app' && item.external_thread_id
      ? `Codex thread: ${item.external_thread_id}`
      : null,
    item.repo_path ? `Repo: ${item.repo_path}` : null,
  ].filter((line): line is string => line !== null)
  return lines.join('\n').trim() || null
}

async function findExistingTask(
  supabase: AiHistoryAuth['supabase'],
  userId: string,
  taskId: string | null,
) {
  if (!taskId) return null
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data as Task | null
}

async function linkLinkedAiTaskToSourceTask(
  supabase: AiHistoryAuth['supabase'],
  userId: string,
  linkedAiTaskId: string | null,
  sourceTaskId: string,
) {
  const aiTaskId = compactString(linkedAiTaskId, 120)
  if (!aiTaskId) return
  const { error } = await supabase
    .from('ai_tasks')
    .update({ source_task_id: sourceTaskId })
    .eq('id', aiTaskId)
    .eq('user_id', userId)
    .in('executor', ['codex', 'codex_app'])
  if (error) throw error
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAiHistoryRequest(request)
  if (!auth) return unauthorized()
  if (!isTursoConfigured()) {
    return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
  }

  const { id } = await context.params
  const body = await request.json().catch(() => ({}))
  const projectId = compactString((body as Record<string, unknown>).projectId ?? (body as Record<string, unknown>).project_id, 120)
  const targetId = compactString((body as Record<string, unknown>).targetId ?? (body as Record<string, unknown>).target_id, 120) ?? 'project-root'
  const position = parsePosition((body as Record<string, unknown>).position)

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  try {
    const item = await getAiHistoryItemForUser(id, auth.user.id)
    if (!item || item.deleted_at || item.archived) {
      return NextResponse.json({ error: 'AI history item not found' }, { status: 404 })
    }

    const existingTask = await findExistingTask(auth.supabase, auth.user.id, item.source_task_id)
    if (existingTask) {
      await linkLinkedAiTaskToSourceTask(auth.supabase, auth.user.id, item.linked_ai_task_id, existingTask.id)
      return NextResponse.json({
        placed: false,
        reused: true,
        task: existingTask,
        item: toAiHistoryListItem(item),
      })
    }

    const { data: project, error: projectError } = await auth.supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', auth.user.id)
      .maybeSingle()
    if (projectError) throw projectError
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    let targetTask: Task | null = null
    if (targetId !== 'project-root') {
      targetTask = await findExistingTask(auth.supabase, auth.user.id, targetId)
      if (!targetTask) return NextResponse.json({ error: 'Target task not found' }, { status: 404 })
      if (targetTask.project_id && targetTask.project_id !== projectId) {
        return NextResponse.json({ error: 'Target task belongs to another project' }, { status: 400 })
      }
    }

    const parentTaskId = targetId === 'project-root'
      ? null
      : position === 'as-child'
        ? targetId
        : targetTask?.parent_task_id ?? null

    let siblingQuery = auth.supabase
      .from('tasks')
      .select('id, order_index')
      .eq('user_id', auth.user.id)
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('order_index', { ascending: true })

    siblingQuery = parentTaskId
      ? siblingQuery.eq('parent_task_id', parentTaskId)
      : siblingQuery.is('parent_task_id', null)

    const { data: siblings, error: siblingsError } = await siblingQuery
    if (siblingsError) throw siblingsError

    const siblingRows = (siblings ?? []) as Array<{ id: string; order_index: number | null }>
    const targetIndex = targetTask && position !== 'as-child'
      ? siblingRows.findIndex(task => task.id === targetTask?.id)
      : -1
    const insertAt = targetIndex >= 0
      ? position === 'above' ? targetIndex : targetIndex + 1
      : siblingRows.length

    const insertPayload: Record<string, unknown> = {
      user_id: auth.user.id,
      project_id: projectId,
      parent_task_id: parentTaskId,
      is_group: false,
      title: item.title,
      memo: memoFromAiHistory(item),
      status: 'todo',
      stage: 'plan',
      order_index: insertAt,
      actual_time_minutes: 0,
      estimated_time: 0,
      source: 'codex_app_thread',
      codex_thread_id: item.external_thread_id,
      codex_status: displayStatus(item.status),
      codex_work_dir: item.worktree_path ?? item.repo_path,
    }

    const { data: createdTask, error: createError } = await auth.supabase
      .from('tasks')
      .insert(insertPayload)
      .select('*')
      .single()

    if (createError) throw createError
    if (!createdTask) throw new Error('Task creation returned no row')

    try {
      await linkLinkedAiTaskToSourceTask(auth.supabase, auth.user.id, item.linked_ai_task_id, String(createdTask.id))

      const reordered = [
        ...siblingRows.slice(0, insertAt),
        { id: String(createdTask.id), order_index: insertAt },
        ...siblingRows.slice(insertAt),
      ]
      await Promise.all(reordered.map((task, index) => {
        if (task.id === createdTask.id || (task.order_index ?? 0) === index) return Promise.resolve()
        return auth.supabase.from('tasks').update({ order_index: index }).eq('id', task.id).eq('user_id', auth.user.id)
      }))

      const updatedItem = await setAiHistorySourceTaskIdForUser({
        id: item.id,
        userId: auth.user.id,
        sourceTaskId: String(createdTask.id),
        projectId,
      })
      if (!updatedItem) throw new Error('AI history item disappeared while placing')

      return NextResponse.json({
        placed: true,
        reused: false,
        task: createdTask,
        item: toAiHistoryListItem(updatedItem),
      })
    } catch (error) {
      await auth.supabase
        .from('tasks')
        .delete()
        .eq('id', createdTask.id)
        .eq('user_id', auth.user.id)
      throw error
    }
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }
    console.error('[ai-history place POST]', error)
    return NextResponse.json({ error: 'AI history placement failed' }, { status: 500 })
  }
}
