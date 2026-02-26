// プロジェクトコンテキスト読み込み
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ProjectContextData {
  project_id: string
  project_name: string
  purpose: string
  current_status: string
  key_insights: string
}

/**
 * ユーザーの全プロジェクトコンテキストを読み込み（プロジェクト名付き）
 */
export async function loadAllProjectContexts(
  supabase: SupabaseClient,
  userId: string
): Promise<ProjectContextData[]> {
  const { data } = await supabase
    .from('ai_project_context')
    .select('project_id, purpose, current_status, key_insights, projects(title)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (!data) return []

  return data.map(row => ({
    project_id: row.project_id,
    project_name: (row.projects as unknown as { title: string } | null)?.title || '',
    purpose: row.purpose || '',
    current_status: row.current_status || '',
    key_insights: row.key_insights || '',
  }))
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
    .filter(c => c.purpose || c.current_status || c.key_insights)
    .slice(0, limit)

  if (filtered.length === 0) return ''

  const lines = filtered.map(c => {
    const parts = [`**${c.project_name}**`]
    if (c.purpose) parts.push(`目的: ${c.purpose}`)
    if (c.current_status) parts.push(`現状: ${c.current_status}`)
    if (c.key_insights) parts.push(`重要点: ${c.key_insights}`)
    return parts.join(' / ')
  })

  return `\n## プロジェクトコンテキスト\n${lines.join('\n')}`
}
