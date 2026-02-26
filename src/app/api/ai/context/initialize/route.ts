import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

/**
 * POST /api/ai/context/initialize
 * ルートフォルダ作成 + 既存データの移行（Lazy Migration）
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

    if (existingFolders && existingFolders.length >= 2) {
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
    let projectsRootId: string | null = null

    if (foldersToCreate.length > 0) {
      const { data: createdFolders, error: folderError } = await supabase
        .from('ai_context_folders')
        .insert(foldersToCreate)
        .select('id, folder_type')

      if (folderError) throw folderError

      personalFolderId = createdFolders?.find(f => f.folder_type === 'root_personal')?.id ?? null
      projectsRootId = createdFolders?.find(f => f.folder_type === 'root_projects')?.id ?? null
    } else {
      personalFolderId = existingFolders?.find(f => f.folder_type === 'root_personal')?.id ?? null
      projectsRootId = existingFolders?.find(f => f.folder_type === 'root_projects')?.id ?? null
    }

    // 2.「自分について」にデフォルトドキュメント作成
    let migratedUserContext = false
    if (personalFolderId) {
      // 既存の ai_user_context からデータ取得
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

    // 3. プロジェクトコンテキストの移行
    let migratedProjectCount = 0
    if (projectsRootId) {
      const { data: oldProjectContexts } = await supabase
        .from('ai_project_context')
        .select('project_id, purpose, current_status, key_insights, updated_at, projects(title)')
        .eq('user_id', user.id)

      if (oldProjectContexts && oldProjectContexts.length > 0) {
        for (const pc of oldProjectContexts) {
          const projects = pc.projects as unknown as { title: string } | { title: string }[] | null
          const projectTitle = (Array.isArray(projects) ? projects[0]?.title : projects?.title) || 'プロジェクト'

          // プロジェクトフォルダ作成
          const { data: projectFolder, error: pfError } = await supabase
            .from('ai_context_folders')
            .insert({
              user_id: user.id,
              parent_id: projectsRootId,
              folder_type: 'project' as const,
              project_id: pc.project_id,
              title: projectTitle,
              order_index: migratedProjectCount,
            })
            .select('id')
            .single()

          if (pfError) {
            console.error('Project folder creation error:', pfError)
            continue
          }

          // プロジェクトドキュメント作成
          const projectDocs = [
            {
              user_id: user.id,
              folder_id: projectFolder.id,
              title: 'プロジェクト目的',
              content: pc.purpose || '',
              document_type: 'project_purpose' as const,
              max_length: 500,
              order_index: 0,
              content_updated_at: pc.updated_at || new Date().toISOString(),
            },
            {
              user_id: user.id,
              folder_id: projectFolder.id,
              title: '現状・進捗',
              content: pc.current_status || '',
              document_type: 'project_status' as const,
              max_length: 500,
              order_index: 1,
              content_updated_at: pc.updated_at || new Date().toISOString(),
            },
            {
              user_id: user.id,
              folder_id: projectFolder.id,
              title: '重要な決定',
              content: pc.key_insights || '',
              document_type: 'project_insights' as const,
              max_length: 500,
              order_index: 2,
              content_updated_at: pc.updated_at || new Date().toISOString(),
            },
          ]

          const { error: pdError } = await supabase
            .from('ai_context_documents')
            .insert(projectDocs)

          if (pdError) {
            console.error('Project docs creation error:', pdError)
            continue
          }

          migratedProjectCount++
        }
      }
    }

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
