/**
 * AI使用量ログ。ai_usage テーブルへの記録と原価推定。
 * Phase 1 は記録のみ（上限チェック・課金は将来）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** モデル名 → 100万トークンあたり料金（USD・概算）。原価は内部監視用なので厳密でなくてよい。 */
const PRICING: { match: string; input: number; output: number }[] = [
  { match: 'gemini-3', input: 0.25, output: 1.5 },
  { match: 'gemini-2.5-flash-lite', input: 0.1, output: 0.4 },
  { match: 'gemini', input: 0.1, output: 0.4 },
  { match: 'deepseek', input: 0.14, output: 0.28 },
]

export function estimateCostUsd(modelName: string, inputTokens: number, outputTokens: number): number {
  const name = modelName.toLowerCase()
  const rate = PRICING.find(p => name.includes(p.match)) ?? { input: 0.2, output: 0.6 }
  const cost = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output
  return Math.round(cost * 1_000_000) / 1_000_000
}

export interface LogAiUsageParams {
  userId: string
  feature: string
  modelName: string
  inputTokens: number
  outputTokens: number
  metadata?: Record<string, unknown>
}

/**
 * 使用量を ai_usage に記録する。
 * 記録失敗は機能本体を止めない（warn のみ）。
 */
export async function logAiUsage(
  supabase: SupabaseClient,
  params: LogAiUsageParams,
): Promise<{ costUsd: number }> {
  const costUsd = estimateCostUsd(params.modelName, params.inputTokens, params.outputTokens)
  try {
    const { error } = await supabase.from('ai_usage').insert({
      user_id: params.userId,
      feature: params.feature,
      model: params.modelName,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      cost_usd: costUsd,
      metadata: params.metadata ?? null,
    })
    if (error) console.warn('[ai_usage] 記録失敗:', error.message)
  } catch (err) {
    console.warn('[ai_usage] 記録失敗:', err)
  }
  return { costUsd }
}
