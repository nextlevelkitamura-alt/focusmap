import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/ai/context - ユーザーの preferences を取得
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data } = await supabase
      .from('ai_user_context')
      .select('preferences')
      .eq('user_id', user.id)
      .maybeSingle()

    return NextResponse.json({
      preferences: data?.preferences ?? {},
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/ai/context - preferences をシャローマージで更新
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { preferences } = body as { preferences: Record<string, unknown> }
    if (!preferences || typeof preferences !== 'object') {
      return NextResponse.json({ error: 'Invalid preferences' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('ai_user_context')
      .select('id, preferences')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      const merged = { ...(existing.preferences as Record<string, unknown> ?? {}), ...preferences }
      await supabase
        .from('ai_user_context')
        .update({ preferences: merged, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('ai_user_context')
        .insert({ user_id: user.id, preferences })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
