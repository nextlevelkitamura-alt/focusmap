import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

const VALID_CATEGORIES = ['life_personality', 'life_purpose', 'current_situation'] as const
type ContextCategory = typeof VALID_CATEGORIES[number]
const MAX_CONTENT_LENGTH = 500

// GET /api/ai/chat/context - ユーザーコンテキスト取得
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data } = await supabase
      .from('ai_user_context')
      .select('life_personality, life_purpose, current_situation, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()

    return NextResponse.json({
      context: data ? {
        life_personality: data.life_personality || '',
        life_purpose: data.life_purpose || '',
        current_situation: data.current_situation || '',
        updated_at: data.updated_at,
      } : null,
    })
  } catch (error) {
    console.error('Get context error:', error)
    return NextResponse.json({ error: 'Failed to get context' }, { status: 500 })
  }
}

// POST /api/ai/chat/context - ユーザーコンテキストのカテゴリ別保存
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { category, content } = body as { category: string; content: string }

    if (!category || !VALID_CATEGORIES.includes(category as ContextCategory)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    const trimmedContent = content.slice(0, MAX_CONTENT_LENGTH)

    // 既存のレコードを取得
    const { data: existing } = await supabase
      .from('ai_user_context')
      .select('id, life_personality, life_purpose, current_situation')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      // 既存の内容とマージ（新しい内容を追記）
      const currentValue = existing[category as ContextCategory] || ''
      const mergedContent = currentValue
        ? `${currentValue}\n${trimmedContent}`.slice(0, MAX_CONTENT_LENGTH)
        : trimmedContent

      const { error: updateError } = await supabase
        .from('ai_user_context')
        .update({
          [category]: mergedContent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (updateError) throw updateError
    } else {
      // 新規作成
      const { error: insertError } = await supabase
        .from('ai_user_context')
        .insert({
          user_id: user.id,
          [category]: trimmedContent,
        })

      if (insertError) throw insertError
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Context update error:', error)
    return NextResponse.json({ error: 'Failed to update context' }, { status: 500 })
  }
}
