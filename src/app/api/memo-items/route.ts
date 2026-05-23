import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  MemoItemKindSchema,
  MemoItemStatusSchema,
  MemoSourceTypeSchema,
  memoItemContentHash,
} from '@/lib/memo-structure'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sourceTypeRaw = request.nextUrl.searchParams.get('source_type')
  const sourceId = request.nextUrl.searchParams.get('source_id')
  const projectId = request.nextUrl.searchParams.get('project_id')
  const status = request.nextUrl.searchParams.get('status')

  let query = supabase
    .from('memo_items')
    .select('*, memo_node_links(*)')
    .eq('user_id', user.id)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true })

  if (sourceTypeRaw) {
    const parsed = MemoSourceTypeSchema.safeParse(sourceTypeRaw)
    if (!parsed.success) return NextResponse.json({ error: 'source_type が不正です' }, { status: 400 })
    query = query.eq('source_type', parsed.data)
  }
  if (sourceId) query = query.eq('source_id', sourceId)
  if (projectId) query = projectId === '__unassigned__' ? query.is('project_id', null) : query.eq('project_id', projectId)
  if (status) query = query.eq('status', status)
  if (!status) query = query.neq('status', 'archived')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ items: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const sourceType = MemoSourceTypeSchema.safeParse(body.source_type)
  const kind = MemoItemKindSchema.safeParse(body.item_kind ?? body.kind ?? 'task_candidate')
  const status = MemoItemStatusSchema.safeParse(body.status ?? 'organized')
  const sourceId = typeof body.source_id === 'string' ? body.source_id : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''

  if (!sourceType.success) return NextResponse.json({ error: 'source_type が不正です' }, { status: 400 })
  if (!sourceId) return NextResponse.json({ error: 'source_id は必須です' }, { status: 400 })
  if (!title) return NextResponse.json({ error: 'title は必須です' }, { status: 400 })
  if (!kind.success || !status.success) return NextResponse.json({ error: 'kind/status が不正です' }, { status: 400 })

  const bodyText = typeof body.body === 'string' ? body.body.trim() : null
  const contentHash = memoItemContentHash({ title, body: bodyText, kind: kind.data })

  const { data: existing } = await supabase
    .from('memo_items')
    .select('*')
    .eq('user_id', user.id)
    .eq('source_type', sourceType.data)
    .eq('source_id', sourceId)
    .eq('content_hash', contentHash)
    .maybeSingle()

  if (existing) return NextResponse.json({ item: existing, reused: true })

  const { data, error } = await supabase
    .from('memo_items')
    .insert({
      user_id: user.id,
      source_type: sourceType.data,
      source_id: sourceId,
      parent_item_id: typeof body.parent_item_id === 'string' ? body.parent_item_id : null,
      project_id: typeof body.project_id === 'string' ? body.project_id : null,
      title,
      body: bodyText,
      item_kind: kind.data,
      status: status.data,
      content_hash: contentHash,
      source_input_hash: typeof body.source_input_hash === 'string' ? body.source_input_hash : contentHash,
      confidence: typeof body.confidence === 'number' ? body.confidence : null,
      order_index: typeof body.order_index === 'number' ? body.order_index : 0,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data, reused: false }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id は必須です' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (typeof body.title === 'string' && body.title.trim()) updates.title = body.title.trim()
  if (body.body === null || typeof body.body === 'string') updates.body = typeof body.body === 'string' ? body.body.trim() : null
  if (body.project_id === null || typeof body.project_id === 'string') updates.project_id = body.project_id || null
  if (body.parent_item_id === null || typeof body.parent_item_id === 'string') updates.parent_item_id = body.parent_item_id || null
  if (typeof body.order_index === 'number') updates.order_index = body.order_index
  if (body.metadata && typeof body.metadata === 'object') updates.metadata = body.metadata

  if (body.item_kind !== undefined) {
    const parsed = MemoItemKindSchema.safeParse(body.item_kind)
    if (!parsed.success) return NextResponse.json({ error: 'item_kind が不正です' }, { status: 400 })
    updates.item_kind = parsed.data
  }
  if (body.status !== undefined) {
    const parsed = MemoItemStatusSchema.safeParse(body.status)
    if (!parsed.success) return NextResponse.json({ error: 'status が不正です' }, { status: 400 })
    updates.status = parsed.data
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('memo_items')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}
