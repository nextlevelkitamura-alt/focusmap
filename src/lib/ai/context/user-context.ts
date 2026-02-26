// ユーザーコンテキスト読み込み
import type { SupabaseClient } from '@supabase/supabase-js'

export interface UserContextData {
  life_personality: string
  life_purpose: string
  current_situation: string
  preferences: Record<string, unknown>
}

/**
 * ai_user_context からユーザーコンテキストを読み込み
 * 旧 persona フィールドからのフォールバック対応
 */
export async function loadUserContext(
  supabase: SupabaseClient,
  userId: string
): Promise<UserContextData | null> {
  const { data } = await supabase
    .from('ai_user_context')
    .select('persona, preferences, life_personality, life_purpose, current_situation')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return null

  return {
    life_personality: data.life_personality || data.persona || '',
    life_purpose: data.life_purpose || '',
    current_situation: data.current_situation || '',
    preferences: (data.preferences as Record<string, unknown>) || {},
  }
}

/**
 * ユーザーコンテキストが未設定かどうか
 */
export function isUserContextEmpty(ctx: UserContextData | null): boolean {
  if (!ctx) return true
  return !ctx.life_personality && !ctx.life_purpose && !ctx.current_situation
}
