import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

/**
 * POST /api/ai/context/documents
 * ドキュメント作成
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { folder_id, title, content, document_type, source, is_pinned } = body as {
      folder_id: string
      title: string
      content?: string
      document_type?: string
      source?: string
      is_pinned?: boolean
    }

    if (!folder_id || !title) {
      return NextResponse.json({ error: 'folder_id and title are required' }, { status: 400 })
    }

    // フォルダの所有者確認
    const { data: folder } = await supabase
      .from('ai_context_folders')
      .select('id')
      .eq('id', folder_id)
      .eq('user_id', user.id)
      .single()

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }

    const { data: doc, error } = await supabase
      .from('ai_context_documents')
      .insert({
        user_id: user.id,
        folder_id,
        title: title.slice(0, 100),
        content: (content || '').slice(0, 2000),
        document_type: document_type || 'note',
        source: source || 'manual',
        is_pinned: is_pinned || false,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ document: doc })
  } catch (error) {
    console.error('Document creation error:', error)
    return NextResponse.json({ error: 'Failed to create document' }, { status: 500 })
  }
}
