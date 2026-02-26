import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { createProjectContextFolder } from '@/lib/ai/context/create-project-context'

/**
 * POST /api/ai/context/initialize
 * ルートフォルダ作成 + 既存データの移行（Lazy Migration）
 * + 未登録プロジェクトのコンテキストフォルダ自動作成
 */
export async function POST() {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 既にルートフォルダが存在するか確認
    const { data: existingFolders } = await supabase
      .from('ai_context_folders')
      .select('id, folder_type')
      .eq('user_id', user.id)
      .in('folder_type', ['root_personal', 'root_projects'])

    const alreadyInitialized = existingFolders && existingFolders.length >= 2

    if (alreadyInitialized) {
      // 既に初期化済みでも、未登録プロジェクトのフォルダを作成
      await ensureAllProjectFolders(supabase, user.id)
      return NextResponse.json({ initialized: true, migrated_user_context: false, migrated_project_contexts: 0 })
    }

    // 1. ルートフォルダ作成
    const foldersToCreate = []
    const hasPersonal = existingFolders?.some(f => f.folder_type === 'root_personal')
    const hasProjects = existingFolders?.some(f => f.folder_type === 'root_projects')

    if (!hasPersonal) {
      foldersToCreate.push({
        user_id: user.id,
        folder_type: 'root_personal' as const,
        title: '自分について',
        icon: 'User',
        order_index: 0,
        is_system: true,
      })
    }
    if (!hasProjects) {
      foldersToCreate.push({
        user_id: user.id,
        folder_type: 'root_projects' as const,
        title: 'プロジェクト',
        icon: 'FolderOpen',
        order_index: 1,
        is_system: true,
      })
    }

    let personalFolderId: string | null = null

    if (foldersToCreate.length > 0) {
      const { data: createdFolders, error: folderError } = await supabase
        .from('ai_context_folders')
        .insert(foldersToCreate)
        .select('id, folder_type')

      if (folderError) throw folderError

      personalFolderId = createdFolders?.find(f => f.folder_type === 'root_personal')?.id ?? null
    } else {
      personalFolderId = existingFolders?.find(f => f.folder_type === 'root_personal')?.id ?? null
    }

    // 2.「自分について」にデフォルトドキュメント作成
    let migratedUserContext = false
    if (personalFolderId) {
      const { data: oldContext } = await supabase
        .from('ai_user_context')
        .select('life_personality, life_purpose, current_situation, persona, updated_at')
        .eq('user_id', user.id)
        .maybeSingle()

      const personality = oldContext?.life_personality || oldContext?.persona || ''
      const purpose = oldContext?.life_purpose || ''
      const situation = oldContext?.current_situation || ''
      const oldUpdatedAt = oldContext?.updated_at || new Date().toISOString()

      const defaultDocs = [
        {
          user_id: user.id,
          folder_id: personalFolderId,
          title: '性格・ライフスタイル',
          content: personality,
          document_type: 'personality' as const,
          max_length: 500,
          order_index: 0,
          content_updated_at: personality ? oldUpdatedAt : new Date().toISOString(),
        },
        {
          user_id: user.id,
          folder_id: personalFolderId,
          title: '目標・価値観',
          content: purpose,
          document_type: 'purpose' as const,
          max_length: 500,
          order_index: 1,
          content_updated_at: purpose ? oldUpdatedAt : new Date().toISOString(),
        },
        {
          user_id: user.id,
          folder_id: personalFolderId,
          title: '今の状況',
          content: situation,
          document_type: 'situation' as const,
          max_length: 500,
          order_index: 2,
          content_updated_at: situation ? oldUpdatedAt : new Date().toISOString(),
        },
      ]

      const { error: docError } = await supabase
        .from('ai_context_documents')
        .insert(defaultDocs)

      if (docError) throw docError
      migratedUserContext = !!(personality || purpose || situation)
    }

    // 3. プロジェクトコンテキストの移行（レガシーデータ）
    let migratedProjectCount = 0
    const { data: oldProjectContexts } = await supabase
      .from('ai_project_context')
      .select('project_id, purpose, current_status, key_insights, updated_at, projects(title)')
      .eq('user_id', user.id)

    if (oldProjectContexts && oldProjectContexts.length > 0) {
      for (const pc of oldProjectContexts) {
        const projects = pc.projects as unknown as { title: string } | { title: string }[] | null
        const projectTitle = (Array.isArray(projects) ? projects[0]?.title : projects?.title) || 'プロジェクト'

        const { folderId, created } = await createProjectContextFolder(supabase, user.id, pc.project_id, projectTitle)
        if (!folderId || !created) continue

        // レガシーデータがある場合、作成されたドキュメントを更新
        const { data: docs } = await supabase
          .from('ai_context_documents')
          .select('id, document_type')
          .eq('folder_id', folderId)

        if (docs) {
          for (const doc of docs) {
            let content = ''
            if (doc.document_type === 'project_purpose') content = pc.purpose || ''
            else if (doc.document_type === 'project_status') content = pc.current_status || ''
            else if (doc.document_type === 'project_insights') content = pc.key_insights || ''

            if (content) {
              await supabase
                .from('ai_context_documents')
                .update({ content, content_updated_at: pc.updated_at || new Date().toISOString() })
                .eq('id', doc.id)
            }
          }
        }

        migratedProjectCount++
      }
    }

    // 4. レガシーデータにないプロジェクトのフォルダも作成
    await ensureAllProjectFolders(supabase, user.id)

    return NextResponse.json({
      initialized: true,
      migrated_user_context: migratedUserContext,
      migrated_project_contexts: migratedProjectCount,
    })
  } catch (error) {
    console.error('Context initialization error:', error)
    return NextResponse.json({ error: 'Failed to initialize context' }, { status: 500 })
  }
}

/**
 * ユーザーの全プロジェクトに対してコンテキストフォルダが存在することを保証する
 */
async function ensureAllProjectFolders(supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never, userId: string) {
  // ユーザーの全プロジェクト取得
  const { data: allProjects } = await supabase
    .from('projects')
    .select('id, title')
    .eq('user_id', userId)

  if (!allProjects || allProjects.length === 0) return

  // 既存のプロジェクトフォルダを取得
  const { data: existingProjectFolders } = await supabase
    .from('ai_context_folders')
    .select('project_id')
    .eq('user_id', userId)
    .eq('folder_type', 'project')

  const existingProjectIds = new Set(existingProjectFolders?.map(f => f.project_id) ?? [])

  // 未登録プロジェクトのフォルダを作成
  for (const project of allProjects) {
    if (!existingProjectIds.has(project.id)) {
      await createProjectContextFolder(supabase, userId, project.id, project.title)
    }
  }
}
