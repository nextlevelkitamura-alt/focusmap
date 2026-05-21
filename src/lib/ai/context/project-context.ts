// プロジェクトコンテキスト読み込み
// コンテキストは projects.description の1フィールドに集約済み（簡素化）。
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ProjectContextData {
  project_id: string
  project_name: string
  description: string
}

/**
 * ユーザーの全プロジェクトのコンテキスト（description）を読み込む
 */
export async function loadAllProjectContexts(
  supabase: SupabaseClient,
  userId: string
): Promise<ProjectContextData[]> {
  const { data } = await supabase
    .from('projects')
    .select('id, title, description')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (!data) return []

  return data.map(row => ({
    project_id: row.id,
    project_name: row.title || '',
    description: row.description || '',
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
    .filter(c => c.description.trim())
    .slice(0, limit)

  if (filtered.length === 0) return ''

  const lines = filtered.map(c => `**${c.project_name}**: ${c.description.trim()}`)

  return `\n## プロジェクトコンテキスト\n${lines.join('\n')}`
}
