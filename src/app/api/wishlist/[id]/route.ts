import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { upsertMemoTags } from '@/lib/memo-tags-server'
import {
  getMindmapTaskIdsFromPayload,
  hasManualMappedColumn,
  keepOnlyExistingMindmapLinks,
  removeManualMappedColumn,
  shouldPreserveMemoColumn,
} from '@/lib/mindmap-memo-links'

type WishlistRow = Record<string, unknown> & {
  id: string
  ai_source_payload?: unknown
  is_completed?: boolean | null
  is_today?: boolean | null
  memo_status?: string | null
  scheduled_at?: string | null
  google_event_id?: string | null
}

async function fetchExistingTaskIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  taskIds: string[],
) {
  const uniqueIds = Array.from(new Set(taskIds))
  if (uniqueIds.length === 0) return new Set<string>()

  const { data, error } = await supabase
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .in('id', uniqueIds)
    .is('deleted_at', null)

  if (error) {
    console.error('[wishlist/[id]] Failed to verify mindmap task links:', error)
    return new Set(uniqueIds)
  }

  return new Set((data ?? []).map(task => task.id).filter((id): id is string => typeof id === 'string'))
}

async function withMindmapLinkMetadata(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  item: WishlistRow,
) {
  const { data: structuredLinks } = await supabase
    .from('memo_node_links')
    .select('id, task_id, created_at')
    .eq('user_id', userId)
    .eq('source_type', 'wishlist')
    .eq('source_id', item.id)
    .eq('link_type', 'mindmap_node')
    .eq('status', 'active')

  const existingTaskIds = await fetchExistingTaskIds(supabase, userId, [
    ...(structuredLinks ?? []).map(link => link.task_id).filter((taskId): taskId is string => !!taskId),
    ...getMindmapTaskIdsFromPayload(item.ai_source_payload),
  ])
  const staleStructuredLinkIds = (structuredLinks ?? [])
    .filter(link => !link.task_id || !existingTaskIds.has(link.task_id))
    .map(link => link.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (staleStructuredLinkIds.length > 0) {
    const { error } = await supabase
      .from('memo_node_links')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('id', staleStructuredLinkIds)
    if (error) console.error('[wishlist/[id]] Failed to archive stale memo_node_links:', error)
  }

  const validStructuredLinks = (structuredLinks ?? []).filter(link => link.task_id && existingTaskIds.has(link.task_id))
  const legacyRepair = keepOnlyExistingMindmapLinks(item.ai_source_payload, existingTaskIds)
  const legacyLinks = legacyRepair.remainingLinks
  const taskIds = new Set<string>()
  const linkedAtCandidates: string[] = []

  for (const link of legacyLinks) {
    if (typeof link.task_id === 'string' && link.task_id.length > 0) taskIds.add(link.task_id)
    if (typeof link.linked_at === 'string') linkedAtCandidates.push(link.linked_at)
  }
  for (const link of validStructuredLinks) {
    if (link.task_id) taskIds.add(link.task_id)
    if (link.created_at) linkedAtCandidates.push(link.created_at)
  }

  let repairedPayload: Record<string, unknown> = legacyRepair.payload
  const hadMappedState =
    legacyRepair.removedLinks.length > 0 ||
    staleStructuredLinkIds.length > 0 ||
    hasManualMappedColumn(item.ai_source_payload)
  if (taskIds.size === 0 && hadMappedState) {
    repairedPayload = removeManualMappedColumn(repairedPayload)
  }
  const shouldResetToUnsorted = taskIds.size === 0 && hadMappedState && !shouldPreserveMemoColumn(item)
  const shouldUpdatePayload =
    legacyRepair.removedLinks.length > 0 ||
    (taskIds.size === 0 && hasManualMappedColumn(item.ai_source_payload))
  if (shouldUpdatePayload || shouldResetToUnsorted) {
    const updates: Record<string, unknown> = {
      ai_source_payload: repairedPayload,
      updated_at: new Date().toISOString(),
    }
    if (shouldResetToUnsorted) updates.memo_status = 'unsorted'
    const { error } = await supabase
      .from('ideal_goals')
      .update(updates)
      .eq('id', item.id)
      .eq('user_id', userId)
    if (error) {
      console.error('[wishlist/[id]] Failed to repair stale mindmap memo state:', error)
    } else {
      item = {
        ...item,
        ai_source_payload: repairedPayload,
        ...(shouldResetToUnsorted ? { memo_status: 'unsorted' } : {}),
      }
    }
  }

  const linkedAt = linkedAtCandidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
  return {
    ...item,
    mindmap_link_count: Math.max(taskIds.size, validStructuredLinks.length),
    mindmap_linked_at: linkedAt,
    mindmap_task_ids: [...taskIds],
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  if (body.project_id) {
    const { error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', body.project_id)
      .eq('user_id', user.id)
      .single()

    if (projectError) {
      return NextResponse.json({ error: 'プロジェクトを確認できませんでした' }, { status: 400 })
    }
  }
  const updates = {
    ...body,
    tags: Array.isArray(body.tags) ? body.tags : body.tags,
    // 完了化したら「今日する」を強制解除（他経路からの完了化でも一貫させる）
    ...(body.is_completed === true ? { is_today: false } : {}),
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('ideal_goals')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*, ideal_items(*)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await upsertMemoTags(supabase, user.id, data.category, data.tags)
  const item = await withMindmapLinkMetadata(supabase, user.id, data as WishlistRow)
  return NextResponse.json({ item })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('ideal_goals')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
