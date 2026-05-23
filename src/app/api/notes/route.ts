import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { NoteInsert } from '@/types/note'

const TRASH_RETENTION_DAYS = 14

function getTrashCutoff() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - TRASH_RETENTION_DAYS)
  return cutoff.toISOString()
}

// DELETE /api/notes?id=xxx - メモ削除
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const noteId = request.nextUrl.searchParams.get('id')
    if (!noteId) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('notes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', noteId)
      .eq('user_id', user.id)
      .is('deleted_at', null)

    if (error) {
      console.error('Error deleting note:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/notes - メモ一覧取得
// GET /api/notes?trash=true - 復元可能な削除済みメモ取得
// GET /api/notes?project_id=xxx&status=pending - プロジェクト・状態で絞り込み
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const showTrash = request.nextUrl.searchParams.get('trash') === 'true'
    const projectId = request.nextUrl.searchParams.get('project_id')
    const status = request.nextUrl.searchParams.get('status')
    const inputType = request.nextUrl.searchParams.get('input_type')
    const q = request.nextUrl.searchParams.get('q')
    const limitParam = parseInt(request.nextUrl.searchParams.get('limit') ?? '', 10)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : showTrash ? 100 : 50

    const query = supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.id)

    if (showTrash) {
      query
        .not('deleted_at', 'is', null)
        .gte('deleted_at', getTrashCutoff())
        .order('deleted_at', { ascending: false })
        .limit(limit)
    } else {
      query
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (projectId === '__unassigned__') {
        query.is('project_id', null)
      } else if (projectId) {
        query.eq('project_id', projectId)
      }

      if (status) query.eq('status', status)
      if (inputType) query.eq('input_type', inputType)
      if (q) query.ilike('content', `%${q}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching notes:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ notes: data })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/notes - メモ更新（プロジェクト紐付けなど）
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, project_id, status, image_urls, restore, used, content } = body

    if (!id) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {}
    if (project_id !== undefined) updateData.project_id = project_id
    if (used === true) updateData.status = 'archived'
    if (used === false) updateData.status = 'pending'
    if (status !== undefined) updateData.status = status
    if (image_urls !== undefined) updateData.image_urls = image_urls
    if (content !== undefined && typeof content === 'string' && content.trim()) {
      updateData.content = content.trim()
    }
    if (restore === true) updateData.deleted_at = null

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    let query = supabase
      .from('notes')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)

    if (restore === true) {
      query = query
        .not('deleted_at', 'is', null)
        .gte('deleted_at', getTrashCutoff())
    } else {
      query = query.is('deleted_at', null)
    }

    const { data, error } = await query
      .select()
      .single()

    if (error) {
      console.error('Error updating note:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ note: data })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/notes - メモ作成
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { content, raw_input, input_type, project_id, image_urls } = body

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    const noteData: NoteInsert = {
      user_id: user.id,
      content: content.trim(),
      raw_input: raw_input || null,
      input_type: input_type || 'text',
      project_id: project_id || null,
      status: 'pending',
      image_urls: Array.isArray(image_urls) && image_urls.length > 0 ? image_urls : null,
    }

    const { data, error } = await supabase
      .from('notes')
      .insert(noteData)
      .select()
      .single()

    if (error) {
      console.error('Error creating note:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ note: data }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
