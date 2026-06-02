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

type StructuredMindmapLink = {
  id: string
  source_id: string
  task_id: string | null
  created_at: string | null
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
    console.error('[wishlist] Failed to verify mindmap task links:', error)
    // 検証に失敗した時は破壊的な自動修復を避ける。
    return new Set(uniqueIds)
  }

  return new Set((data ?? []).map(task => task.id).filter((id): id is string => typeof id === 'string'))
}

async function archiveStaleStructuredLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  linkIds: string[],
) {
  if (linkIds.length === 0) return
  const { error } = await supabase
    .from('memo_node_links')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('id', linkIds)

  if (error) {
    console.error('[wishlist] Failed to archive stale memo_node_links:', error)
  }
}

async function withMindmapLinkMetadata(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  rows: WishlistRow[] | null,
) {
  const items = rows ?? []
  if (items.length === 0) return items

  const ids = items.map(item => item.id)
  const { data: structuredLinksRaw } = await supabase
    .from('memo_node_links')
    .select('id, source_id, task_id, created_at')
    .eq('user_id', userId)
    .eq('source_type', 'wishlist')
    .eq('link_type', 'mindmap_node')
    .eq('status', 'active')
    .in('source_id', ids)

  const structuredLinks = (structuredLinksRaw ?? []) as StructuredMindmapLink[]
  const allTaskIds = [
    ...structuredLinks.map(link => link.task_id).filter((taskId): taskId is string => !!taskId),
    ...items.flatMap(item => getMindmapTaskIdsFromPayload(item.ai_source_payload)),
  ]
  const existingTaskIds = await fetchExistingTaskIds(supabase, userId, allTaskIds)
  const staleStructuredLinkIds = structuredLinks
    .filter(link => !link.task_id || !existingTaskIds.has(link.task_id))
    .map(link => link.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  await archiveStaleStructuredLinks(supabase, userId, staleStructuredLinkIds)
  const validStructuredLinks = structuredLinks.filter(link => link.task_id && existingTaskIds.has(link.task_id))

  const linkMetaBySourceId = new Map<string, { taskIds: Set<string>; count: number; linkedAt: string | null }>()
  for (const link of validStructuredLinks) {
    if (!link.source_id) continue
    const current = linkMetaBySourceId.get(link.source_id) ?? { taskIds: new Set<string>(), count: 0, linkedAt: null }
    current.count += 1
    if (link.task_id) current.taskIds.add(link.task_id)
    if (link.created_at && (!current.linkedAt || new Date(link.created_at).getTime() > new Date(current.linkedAt).getTime())) {
      current.linkedAt = link.created_at
    }
    linkMetaBySourceId.set(link.source_id, current)
  }

  const repairedItems = await Promise.all(items.map(async item => {
    const legacyRepair = keepOnlyExistingMindmapLinks(item.ai_source_payload, existingTaskIds)
    const legacyLinks = legacyRepair.remainingLinks
    const legacyTaskIds = legacyLinks
      .map(link => link.task_id)
      .filter((taskId): taskId is string => typeof taskId === 'string' && taskId.length > 0)
    const legacyLinkedAt = legacyLinks
      .map(link => typeof link.linked_at === 'string' ? link.linked_at : null)
      .filter((value): value is string => !!value)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
    const structuredMeta = linkMetaBySourceId.get(item.id)
    const taskIds = new Set([...(structuredMeta?.taskIds ?? []), ...legacyTaskIds])
    const linkedAtCandidates = [structuredMeta?.linkedAt ?? null, legacyLinkedAt].filter((value): value is string => !!value)
    const linkedAt = linkedAtCandidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null

    let repairedPayload: Record<string, unknown> = legacyRepair.payload
    const structuredHadStale = structuredLinks.some(link =>
      link.source_id === item.id && (!link.task_id || !existingTaskIds.has(link.task_id)),
    )
    const hadMappedState =
      legacyRepair.removedLinks.length > 0 ||
      structuredHadStale ||
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
        console.error('[wishlist] Failed to repair stale mindmap memo state:', error)
      } else {
        item = {
          ...item,
          ai_source_payload: repairedPayload,
          ...(shouldResetToUnsorted ? { memo_status: 'unsorted' } : {}),
        }
      }
    }

    return {
      ...item,
      mindmap_link_count: Math.max(taskIds.size, structuredMeta?.count ?? 0, legacyTaskIds.length),
      mindmap_linked_at: linkedAt,
      mindmap_task_ids: [...taskIds],
    }
  }))

  return repairedItems
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const spaceId = request.nextUrl.searchParams.get('space_id')
  const projectId = request.nextUrl.searchParams.get('project_id')

  let query = supabase
    .from('ideal_goals')
    .select('*, ideal_items(*)')
    .in('status', ['wishlist', 'memo'])
    .order('display_order', { ascending: true })
    .order('created_at', { referencedTable: 'ideal_items', ascending: true })

  if (projectId === '__unassigned__') {
    query = query.eq('user_id', user.id).is('project_id', null)
  } else if (projectId) {
    query = query.eq('user_id', user.id).eq('project_id', projectId)
  } else if (spaceId === '__unassigned__') {
    query = query.eq('user_id', user.id).is('project_id', null)
  } else if (spaceId) {
    const { data: projects, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('space_id', spaceId)
    if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 })
    const ids = (projects ?? []).map(p => p.id)
    if (ids.length === 0) return NextResponse.json({ items: [] })
    query = query.in('project_id', ids)
  } else {
    query = query.eq('user_id', user.id)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const items = await withMindmapLinkMetadata(supabase, user.id, data as WishlistRow[] | null)
  return NextResponse.json({ items })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    id,
    title,
    project_id,
    description,
    cover_image_url,
    cover_image_path,
    category,
    color,
    status,
    display_order,
    duration_months,
    start_date,
    target_date,
    total_daily_minutes,
    cost_total,
    cost_monthly,
    ai_summary,
    scheduled_at,
    duration_minutes,
    google_event_id,
    is_completed,
    is_today,
    tags,
    memo_status,
    ai_source_payload,
    created_at,
    updated_at,
    ideal_items,
    subtask_suggestions,
  } = body

  const trimmedTitle = typeof title === 'string' ? title.trim() : ''
  if (!trimmedTitle) return NextResponse.json({ error: 'タイトルは必須です' }, { status: 400 })

  if (project_id) {
    const { error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', project_id)
      .eq('user_id', user.id)
      .single()

    if (projectError) {
      return NextResponse.json({ error: 'プロジェクトを確認できませんでした' }, { status: 400 })
    }
  }

  const { count } = await supabase
    .from('ideal_goals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('status', ['wishlist', 'memo'])

  const insertPayload: Record<string, unknown> = {
    user_id: user.id,
    title: trimmedTitle,
    project_id: project_id || null,
    description: description ?? null,
    cover_image_url: cover_image_url ?? null,
    cover_image_path: cover_image_path ?? null,
    category: category ?? null,
    scheduled_at: scheduled_at ?? null,
    duration_minutes: duration_minutes ?? null,
    google_event_id: google_event_id ?? null,
    tags: Array.isArray(tags) ? tags : [],
    memo_status: memo_status ?? (scheduled_at ? 'time_candidates' : 'unsorted'),
    ai_source_payload: ai_source_payload ?? null,
    status: status ?? 'memo',
    color: color ?? '#6366f1',
    display_order: typeof display_order === 'number' ? display_order : (count ?? 0) + 1,
    duration_months: duration_months ?? null,
    start_date: start_date ?? null,
    target_date: target_date ?? null,
    total_daily_minutes: typeof total_daily_minutes === 'number' ? total_daily_minutes : 0,
    cost_total: cost_total ?? null,
    cost_monthly: cost_monthly ?? null,
    ai_summary: ai_summary ?? null,
    is_completed: is_completed ?? false,
    is_today: is_today ?? false,
  }
  if (typeof id === 'string') insertPayload.id = id
  if (typeof created_at === 'string') insertPayload.created_at = created_at
  if (typeof updated_at === 'string') insertPayload.updated_at = updated_at

  const { data, error } = await supabase
    .from('ideal_goals')
    .insert(insertPayload)
    .select('*, ideal_items(*)')
    .single()

  let savedItem = data
  if (error) {
    const canRetryWithoutAiPayload =
      error.message.includes('ai_source_payload') ||
      error.message.includes("Could not find the 'ai_source_payload' column")

    if (!canRetryWithoutAiPayload) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const fallbackPayload = { ...insertPayload }
    delete fallbackPayload.ai_source_payload
    const retry = await supabase
      .from('ideal_goals')
      .insert(fallbackPayload)
      .select('*, ideal_items(*)')
      .single()

    if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 })
    savedItem = retry.data
  }

  if (savedItem?.id && Array.isArray(ideal_items) && ideal_items.length > 0) {
    const rows = ideal_items
      .filter((item: { title?: string }) => item?.title?.trim())
      .map((item: {
        id?: string
        title: string
        item_type?: string
        frequency_type?: string
        frequency_value?: number
        session_minutes?: number
        daily_minutes?: number
        item_cost?: number | null
        cost_type?: string | null
        is_done?: boolean
        linked_task_id?: string | null
        linked_habit_id?: string | null
        display_order?: number
        description?: string | null
        scheduled_date?: string | null
        reference_url?: string | null
        thumbnail_url?: string | null
        thumbnail_path?: string | null
        parent_item_id?: string | null
        created_at?: string
        updated_at?: string
      }, index: number) => ({
        ...(typeof item.id === 'string' ? { id: item.id } : {}),
        ideal_id: savedItem.id,
        user_id: user.id,
        title: item.title.trim(),
        item_type: item.item_type ?? 'task',
        frequency_type: item.frequency_type ?? 'once',
        frequency_value: item.frequency_value ?? 1,
        session_minutes: item.session_minutes ?? 0,
        daily_minutes: item.daily_minutes ?? 0,
        item_cost: item.item_cost ?? null,
        cost_type: item.cost_type ?? null,
        is_done: item.is_done ?? false,
        linked_task_id: item.linked_task_id ?? null,
        linked_habit_id: item.linked_habit_id ?? null,
        display_order: item.display_order ?? index,
        description: item.description ?? null,
        scheduled_date: item.scheduled_date ?? null,
        reference_url: item.reference_url ?? null,
        thumbnail_url: item.thumbnail_url ?? null,
        thumbnail_path: item.thumbnail_path ?? null,
        parent_item_id: item.parent_item_id ?? null,
        ...(typeof item.created_at === 'string' ? { created_at: item.created_at } : {}),
        ...(typeof item.updated_at === 'string' ? { updated_at: item.updated_at } : {}),
      }))
    if (rows.length > 0) {
      await supabase.from('ideal_items').insert(rows)
    }
  } else if (savedItem?.id && Array.isArray(subtask_suggestions) && subtask_suggestions.length > 0) {
    const rows = subtask_suggestions
      .filter((sub: { title?: string }) => sub?.title?.trim())
      .slice(0, 8)
      .map((sub: { title: string; estimated_minutes?: number; reason?: string }, index: number) => ({
        ideal_id: savedItem.id,
        user_id: user.id,
        title: sub.title.trim(),
        item_type: 'task',
        frequency_type: 'once',
        frequency_value: 1,
        session_minutes: sub.estimated_minutes ?? 0,
        daily_minutes: 0,
        description: sub.reason ?? null,
        display_order: index,
      }))
    if (rows.length > 0) {
      await supabase.from('ideal_items').insert(rows)
    }
  }

  await upsertMemoTags(supabase, user.id, category, tags)

  const { data: item } = await supabase
    .from('ideal_goals')
    .select('*, ideal_items(*)')
    .eq('id', savedItem.id)
    .single()

  const [withMetadata] = await withMindmapLinkMetadata(supabase, user.id, [(item ?? savedItem) as WishlistRow])
  return NextResponse.json({ item: withMetadata ?? item ?? savedItem }, { status: 201 })
}
