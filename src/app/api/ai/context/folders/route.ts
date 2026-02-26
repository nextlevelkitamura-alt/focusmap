import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { calculateFreshnessScore, getFreshnessStatus, daysSinceUpdate } from '@/lib/ai/context/freshness'

import type { AiContextFolder, AiContextDocument } from '@/types/database'

interface FolderTreeNode {
  id: string
  parent_id: string | null
  folder_type: string
  project_id: string | null
  title: string
  icon: string | null
  order_index: number
  is_system: boolean
  documents: Array<AiContextDocument & {
    freshness_score: number
    freshness_status: string
    days_since_update: number
  }>
  children: FolderTreeNode[]
}

/**
 * GET /api/ai/context/folders
 * フォルダ・ドキュメントをツリー構造で返す
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // フォルダとドキュメントを並行で取得
    const [foldersResult, documentsResult] = await Promise.all([
      supabase
        .from('ai_context_folders')
        .select('*')
        .eq('user_id', user.id)
        .order('order_index', { ascending: true }),
      supabase
        .from('ai_context_documents')
        .select('*')
        .eq('user_id', user.id)
        .order('order_index', { ascending: true }),
    ])

    if (foldersResult.error) throw foldersResult.error
    if (documentsResult.error) throw documentsResult.error

    const folders = (foldersResult.data || []) as AiContextFolder[]
    const documents = (documentsResult.data || []) as AiContextDocument[]

    // ドキュメントに鮮度情報を付与
    const docsWithFreshness = documents.map(doc => {
      const score = calculateFreshnessScore(
        doc.content_updated_at,
        doc.freshness_reviewed_at,
        doc.document_type,
      )
      return {
        ...doc,
        freshness_score: Math.round(score * 100) / 100,
        freshness_status: getFreshnessStatus(score),
        days_since_update: daysSinceUpdate(doc.content_updated_at, doc.freshness_reviewed_at),
      }
    })

    // ツリー構造を構築
    const folderMap = new Map<string, FolderTreeNode>()
    for (const folder of folders) {
      folderMap.set(folder.id, {
        ...folder,
        documents: docsWithFreshness.filter(d => d.folder_id === folder.id),
        children: [],
      })
    }

    const rootFolders: FolderTreeNode[] = []
    for (const folder of folders) {
      const node = folderMap.get(folder.id)!
      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        folderMap.get(folder.parent_id)!.children.push(node)
      } else {
        rootFolders.push(node)
      }
    }

    return NextResponse.json({ folders: rootFolders })
  } catch (error) {
    console.error('Folders fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch folders' }, { status: 500 })
  }
}

/**
 * POST /api/ai/context/folders
 * フォルダ作成
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { parent_id, title, folder_type, project_id, icon } = body as {
      parent_id?: string | null
      title: string
      folder_type?: string
      project_id?: string
      icon?: string
    }

    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    const { data: folder, error } = await supabase
      .from('ai_context_folders')
      .insert({
        user_id: user.id,
        parent_id: parent_id || null,
        title: title.slice(0, 100),
        folder_type: folder_type || 'custom',
        project_id: project_id || null,
        icon: icon || null,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ folder })
  } catch (error) {
    console.error('Folder creation error:', error)
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 })
  }
}
