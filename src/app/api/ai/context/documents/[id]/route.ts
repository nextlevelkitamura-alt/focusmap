import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

/**
 * PATCH /api/ai/context/documents/[id]
 * ドキュメント更新（content変更時は content_updated_at も更新）
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { id } = await params

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { title, content, is_pinned, order_index, freshness_reviewed_at } = body as {
      title?: string
      content?: string
      is_pinned?: boolean
      order_index?: number
      freshness_reviewed_at?: string
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (title !== undefined) updateData.title = title.slice(0, 100)
    if (content !== undefined) {
      updateData.content = content.slice(0, 2000)
      updateData.content_updated_at = new Date().toISOString()
    }
    if (is_pinned !== undefined) updateData.is_pinned = is_pinned
    if (order_index !== undefined) updateData.order_index = order_index
    if (freshness_reviewed_at !== undefined) {
      updateData.freshness_reviewed_at = freshness_reviewed_at
    }

    const { data: doc, error } = await supabase
      .from('ai_context_documents')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ document: doc })
  } catch (error) {
    console.error('Document update error:', error)
    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 })
  }
}

/**
 * DELETE /api/ai/context/documents/[id]
 * ドキュメント削除
 */
export async function DELETE(
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

    const { error } = await supabase
      .from('ai_context_documents')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Document delete error:', error)
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
  }
}
