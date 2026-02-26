import { SupabaseClient } from '@supabase/supabase-js'

/**
 * プロジェクト用のAIコンテキストフォルダとデフォルトドキュメントを作成する。
 * 既にフォルダが存在する場合はスキップ（冪等性）。
 */
export async function createProjectContextFolder(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  projectTitle: string
): Promise<{ folderId: string | null; created: boolean }> {
  // 既存チェック（冪等性）
  const { data: existing } = await supabase
    .from('ai_context_folders')
    .select('id')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .eq('folder_type', 'project')
    .maybeSingle()

  if (existing) {
    return { folderId: existing.id, created: false }
  }

  // root_projects フォルダの存在確認
  let { data: rootProjects } = await supabase
    .from('ai_context_folders')
    .select('id')
    .eq('user_id', userId)
    .eq('folder_type', 'root_projects')
    .maybeSingle()

  // root_projects がなければ作成
  if (!rootProjects) {
    const { data: created, error } = await supabase
      .from('ai_context_folders')
      .insert({
        user_id: userId,
        folder_type: 'root_projects',
        title: 'プロジェクト',
        icon: 'FolderOpen',
        order_index: 1,
        is_system: true,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Failed to create root_projects folder:', error)
      return { folderId: null, created: false }
    }
    rootProjects = created
  }

  // プロジェクトフォルダ作成
  const { data: projectFolder, error: folderError } = await supabase
    .from('ai_context_folders')
    .insert({
      user_id: userId,
      parent_id: rootProjects.id,
      folder_type: 'project',
      project_id: projectId,
      title: projectTitle,
      order_index: 0,
    })
    .select('id')
    .single()

  if (folderError) {
    console.error('Failed to create project context folder:', folderError)
    return { folderId: null, created: false }
  }

  // デフォルトドキュメント3件を作成
  const now = new Date().toISOString()
  const { error: docsError } = await supabase
    .from('ai_context_documents')
    .insert([
      {
        user_id: userId,
        folder_id: projectFolder.id,
        title: 'プロジェクト目的',
        content: '',
        document_type: 'project_purpose',
        max_length: 500,
        order_index: 0,
        content_updated_at: now,
      },
      {
        user_id: userId,
        folder_id: projectFolder.id,
        title: '現状・進捗',
        content: '',
        document_type: 'project_status',
        max_length: 500,
        order_index: 1,
        content_updated_at: now,
      },
      {
        user_id: userId,
        folder_id: projectFolder.id,
        title: '重要な決定',
        content: '',
        document_type: 'project_insights',
        max_length: 500,
        order_index: 2,
        content_updated_at: now,
      },
    ])

  if (docsError) {
    console.error('Failed to create project context documents:', docsError)
  }

  return { folderId: projectFolder.id, created: true }
}
