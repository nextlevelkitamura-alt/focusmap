import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

/**
 * PATCH /api/ai/context/folders/[id]
 * フォルダ更新
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
    const { title, icon, order_index } = body as {
      title?: string
      icon?: string
      order_index?: number
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (title !== undefined) updateData.title = title.slice(0, 100)
    if (icon !== undefined) updateData.icon = icon
    if (order_index !== undefined) updateData.order_index = order_index

    const { data: folder, error } = await supabase
      .from('ai_context_folders')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ folder })
  } catch (error) {
    console.error('Folder update error:', error)
    return NextResponse.json({ error: 'Failed to update folder' }, { status: 500 })
  }
}

/**
 * DELETE /api/ai/context/folders/[id]
 * フォルダ削除（is_system=true は拒否）
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

    // システムフォルダの削除を防止
    const { data: folder } = await supabase
      .from('ai_context_folders')
      .select('is_system')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }
    if (folder.is_system) {
      return NextResponse.json({ error: 'Cannot delete system folder' }, { status: 403 })
    }

    const { error } = await supabase
      .from('ai_context_folders')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Folder delete error:', error)
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 500 })
  }
}
