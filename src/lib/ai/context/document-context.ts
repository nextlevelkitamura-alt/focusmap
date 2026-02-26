/**
 * フォルダ/ドキュメント型のコンテキスト読み込み
 * 新テーブル (ai_context_documents) から読み込み、
 * 旧テーブル (ai_user_context) へのフォールバック付き
 */

import { SupabaseClient } from '@supabase/supabase-js'
import {
  buildFreshnessAlertForPrompt,
} from './freshness'

interface ContextDocument {
  id: string
  title: string
  content: string
  document_type: string
  is_pinned: boolean
  content_updated_at: string
  freshness_reviewed_at: string | null
}

interface ContextInjection {
  personalContext: string
  projectContext: string
  freshnessAlerts: string
  userContextCategories: Partial<Record<'life_personality' | 'life_purpose' | 'current_situation', string>>
  userPreferences: Record<string, unknown>
}

/** ドキュメントタイプ → 旧カテゴリ名のマッピング */
const DOC_TYPE_TO_CATEGORY: Record<string, 'life_personality' | 'life_purpose' | 'current_situation'> = {
  personality: 'life_personality',
  purpose: 'life_purpose',
  situation: 'current_situation',
}

/**
 * 新テーブルからコンテキストを読み込み、フォールバック付きで返す
 */
export async function loadContextFromDocuments(
  supabase: SupabaseClient,
  userId: string,
): Promise<ContextInjection> {
  // 新テーブルからドキュメントを取得
  const { data: documents } = await supabase
    .from('ai_context_documents')
    .select('id, title, content, document_type, is_pinned, content_updated_at, freshness_reviewed_at, ai_context_folders(folder_type, project_id)')
    .eq('user_id', userId)
    .order('is_pinned', { ascending: false })
    .order('order_index', { ascending: true })

  // 新テーブルにデータがある場合
  if (documents && documents.length > 0) {
    return buildInjectionFromDocuments(documents as unknown as (ContextDocument & { ai_context_folders: { folder_type: string; project_id: string | null } })[])
  }

  // フォールバック: 旧テーブルから読み込み
  return loadLegacyContext(supabase, userId)
}

/**
 * 新テーブルのドキュメントからコンテキスト注入データを構築
 */
function buildInjectionFromDocuments(
  documents: (ContextDocument & { ai_context_folders: { folder_type: string; project_id: string | null } })[],
): ContextInjection {
  const userContextCategories: Partial<Record<'life_personality' | 'life_purpose' | 'current_situation', string>> = {}

  // 個人ドキュメント
  const personalDocs = documents.filter(d =>
    d.ai_context_folders.folder_type === 'root_personal' ||
    (!d.ai_context_folders.project_id && ['personality', 'purpose', 'situation', 'note'].includes(d.document_type))
  )

  // カテゴリマッピング
  for (const doc of personalDocs) {
    const category = DOC_TYPE_TO_CATEGORY[doc.document_type]
    if (category && doc.content) {
      userContextCategories[category] = doc.content
    }
  }

  // 個人コンテキスト文字列
  const personalParts: string[] = []
  for (const doc of personalDocs) {
    if (!doc.content) continue
    personalParts.push(`${doc.title}: ${doc.content}`)
  }
  const personalContext = personalParts.length > 0
    ? `\n## ユーザーの情報\n${personalParts.join('\n')}`
    : ''

  // プロジェクトドキュメント（ピン留め or 新しいもの上位3プロジェクト分）
  const projectDocs = documents.filter(d =>
    d.ai_context_folders.folder_type === 'project' ||
    d.ai_context_folders.project_id
  )

  // プロジェクトIDでグループ化
  const projectGroups = new Map<string, ContextDocument[]>()
  for (const doc of projectDocs) {
    const pid = (doc as unknown as { ai_context_folders: { project_id: string | null } }).ai_context_folders.project_id || 'unknown'
    if (!projectGroups.has(pid)) projectGroups.set(pid, [])
    projectGroups.get(pid)!.push(doc)
  }

  const projectParts: string[] = []
  let count = 0
  for (const [, docs] of projectGroups) {
    if (count >= 3) break
    const nonEmpty = docs.filter(d => d.content)
    if (nonEmpty.length === 0) continue
    const lines = nonEmpty.map(d => `${d.title}: ${d.content}`).join(' / ')
    projectParts.push(lines)
    count++
  }
  const projectContext = projectParts.length > 0
    ? `\n## プロジェクトコンテキスト\n${projectParts.join('\n')}`
    : ''

  // 鮮度アラート
  const freshnessAlerts = buildFreshnessAlertForPrompt(
    documents.map(d => ({
      title: d.title,
      content_updated_at: d.content_updated_at,
      freshness_reviewed_at: d.freshness_reviewed_at,
      document_type: d.document_type,
    })),
  )

  return {
    personalContext,
    projectContext,
    freshnessAlerts,
    userContextCategories,
    userPreferences: {},
  }
}

/**
 * 旧テーブルからのフォールバック読み込み
 */
async function loadLegacyContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<ContextInjection> {
  const { data: userContext } = await supabase
    .from('ai_user_context')
    .select('persona, preferences, life_personality, life_purpose, current_situation')
    .eq('user_id', userId)
    .maybeSingle()

  const userContextCategories: Partial<Record<'life_personality' | 'life_purpose' | 'current_situation', string>> = {}
  const userPreferences = (userContext?.preferences as Record<string, unknown>) || {}

  if (userContext) {
    if (userContext.life_personality) userContextCategories.life_personality = userContext.life_personality
    if (userContext.life_purpose) userContextCategories.life_purpose = userContext.life_purpose
    if (userContext.current_situation) userContextCategories.current_situation = userContext.current_situation
    if (!userContext.life_personality && userContext.persona) {
      userContextCategories.life_personality = userContext.persona
    }
  }

  const parts: string[] = []
  if (userContextCategories.life_personality) parts.push(`生活・性格: ${userContextCategories.life_personality}`)
  if (userContextCategories.life_purpose) parts.push(`目標・価値観: ${userContextCategories.life_purpose}`)
  if (userContextCategories.current_situation) parts.push(`最近の状況: ${userContextCategories.current_situation}`)

  const personalContext = parts.length > 0
    ? `\n## ユーザーの情報\n${parts.join('\n')}`
    : ''

  return {
    personalContext,
    projectContext: '',
    freshnessAlerts: '',
    userContextCategories,
    userPreferences,
  }
}
