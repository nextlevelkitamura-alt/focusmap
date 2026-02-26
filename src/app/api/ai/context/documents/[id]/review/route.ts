import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

/**
 * POST /api/ai/context/documents/[id]/review
 * 「最新です」確認 - 鮮度スコアをリセット
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { id } = await params

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: doc, error } = await supabase
      .from('ai_context_documents')
      .update({
        freshness_reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ document: doc })
  } catch (error) {
    console.error('Document review error:', error)
    return NextResponse.json({ error: 'Failed to review document' }, { status: 500 })
  }
}
