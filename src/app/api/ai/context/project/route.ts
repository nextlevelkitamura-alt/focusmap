import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

const MAX_FIELD_LENGTH = 500

// GET /api/ai/context/project - 全プロジェクトコンテキスト取得
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('ai_project_context')
      .select('id, project_id, purpose, current_status, key_insights, updated_at, projects(title)')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({
      contexts: (data || []).map(row => ({
        id: row.id,
        project_id: row.project_id,
        project_name: (row.projects as unknown as { title: string } | null)?.title || '',
        purpose: row.purpose,
        current_status: row.current_status,
        key_insights: row.key_insights,
        updated_at: row.updated_at,
      })),
    })
  } catch (error) {
    console.error('Get project context error:', error)
    return NextResponse.json({ error: 'Failed to get project context' }, { status: 500 })
  }
}

// POST /api/ai/context/project - プロジェクトコンテキスト保存（upsert）
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { project_id, purpose, current_status, key_insights } = body as {
      project_id: string
      purpose?: string
      current_status?: string
      key_insights?: string
    }

    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
    }

    const updateData = {
      purpose: (purpose || '').slice(0, MAX_FIELD_LENGTH),
      current_status: (current_status || '').slice(0, MAX_FIELD_LENGTH),
      key_insights: (key_insights || '').slice(0, MAX_FIELD_LENGTH),
      updated_at: new Date().toISOString(),
    }

    // Upsert: 既存があれば更新、なければ作成
    const { data: existing } = await supabase
      .from('ai_project_context')
      .select('id')
      .eq('user_id', user.id)
      .eq('project_id', project_id)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('ai_project_context')
        .update(updateData)
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('ai_project_context')
        .insert({
          user_id: user.id,
          project_id,
          ...updateData,
        })
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Save project context error:', error)
    return NextResponse.json({ error: 'Failed to save project context' }, { status: 500 })
  }
}
