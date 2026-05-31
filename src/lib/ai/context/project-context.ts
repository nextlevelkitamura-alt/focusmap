import type { SupabaseClient } from '@supabase/supabase-js'

export interface ProjectContextData {
  project_id: string
  project_name: string
  description: string
}

export async function loadAllProjectContexts(
  supabase: SupabaseClient,
  userId: string
): Promise<ProjectContextData[]> {
  const { data: projects } = await supabase
    .from('projects')
    .select('id, title, description')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (!projects) return []

  const { data: contexts } = await supabase
    .from('project_contexts')
    .select('project_id, heading, details, progress')
    .eq('user_id', userId)

  const contextByProject = new Map(
    (contexts ?? []).map(row => [row.project_id, row])
  )

  return projects.map(project => ({
    project_id: project.id,
    project_name: project.title || '',
    description: formatCompactProjectContext(
      contextByProject.get(project.id),
      project.description || ''
    ),
  }))
}

function formatCompactProjectContext(
  context: { heading?: string | null; details?: string | null; progress?: string | null } | undefined,
  fallbackDescription: string
) {
  if (!context) return fallbackDescription

  const parts = [
    context.heading?.trim(),
    context.details?.trim(),
    context.progress?.trim() ? `進捗: ${context.progress.trim()}` : '',
  ].filter(Boolean)

  return parts.join('\n') || fallbackDescription
}

/**
 * プロジェクトコンテキストをプロンプト注入用テキストにフォーマット
 * 上位 limit 件のみ出力（コンテキスト節約）
 */
export function formatProjectContextsForPrompt(
  contexts: ProjectContextData[],
  limit = 3
): string {
  const filtered = contexts
    .filter(c => c.description.trim())
    .slice(0, limit)

  if (filtered.length === 0) return ''

  const lines = filtered.map(c => `**${c.project_name}**: ${c.description.trim()}`)

  return `\n## プロジェクトコンテキスト\n${lines.join('\n')}`
}
