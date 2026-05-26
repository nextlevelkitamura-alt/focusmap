import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { upsertMemoTags } from '@/lib/memo-tags-server'

type WishlistRow = Record<string, unknown> & {
  id: string
  ai_source_payload?: unknown
}

function readMindmapLinks(payload: unknown): Array<{ task_id?: unknown; linked_at?: unknown }> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const links = (payload as { mindmap_links?: unknown }).mindmap_links
  if (!Array.isArray(links)) return []
  return links.filter((link): link is { task_id?: unknown; linked_at?: unknown } =>
    !!link && typeof link === 'object' && !Array.isArray(link),
  )
}

async function withMindmapLinkMetadata(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  item: WishlistRow,
) {
  const { data: structuredLinks } = await supabase
    .from('memo_node_links')
    .select('task_id, created_at')
    .eq('user_id', userId)
    .eq('source_type', 'wishlist')
    .eq('source_id', item.id)
    .eq('link_type', 'mindmap_node')
    .eq('status', 'active')

  const legacyLinks = readMindmapLinks(item.ai_source_payload)
  const taskIds = new Set<string>()
  const linkedAtCandidates: string[] = []

  for (const link of legacyLinks) {
    if (typeof link.task_id === 'string' && link.task_id.length > 0) taskIds.add(link.task_id)
    if (typeof link.linked_at === 'string') linkedAtCandidates.push(link.linked_at)
  }
  for (const link of structuredLinks ?? []) {
    if (link.task_id) taskIds.add(link.task_id)
    if (link.created_at) linkedAtCandidates.push(link.created_at)
  }

  const linkedAt = linkedAtCandidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
  return {
    ...item,
    mindmap_link_count: Math.max(taskIds.size, structuredLinks?.length ?? 0),
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
