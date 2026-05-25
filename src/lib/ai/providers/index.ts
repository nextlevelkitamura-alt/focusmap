/**
 * AI プロバイダー — Vercel AI SDK ベース
 *
 * 現在: 全スキルで Gemini Flash Preview を使用
 * 将来: APIキー追加で OpenAI / Anthropic に切替可能
 */
import { google } from '@ai-sdk/google'
import { deepseek } from '@ai-sdk/deepseek'
import type { AgentId } from '../agents/index'

// 将来追加:
// import { openai } from '@ai-sdk/openai'
// import { anthropic } from '@ai-sdk/anthropic'

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'

const REMOVED_OR_INVALID_GEMINI_MODELS = new Set([
  'gemini-3.0-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
])

export function resolveGeminiModel(modelName = process.env.GEMINI_MODEL): string {
  const requested = modelName?.trim()
  if (!requested) return DEFAULT_GEMINI_MODEL
  if (REMOVED_OR_INVALID_GEMINI_MODELS.has(requested)) return DEFAULT_GEMINI_MODEL
  if (!requested.startsWith('gemini-')) return DEFAULT_GEMINI_MODEL
  return requested
}

export interface SkillModelConfig {
  maxTokens: number
  temperature: number
}

/**
 * スキルごとのモデル設定
 * 現在は全て同じモデルだが、将来スキルごとに最適なモデルを割り当て可能
 */
const SKILL_CONFIG: Record<string, SkillModelConfig> = {
  // 軽量スキル（構造化タスク → 高速・低コスト）
  scheduling: { maxTokens: 800, temperature: 0.3 },
  task: { maxTokens: 1200, temperature: 0.3 },
  // 中量スキル（対話 + 構造化）
  counseling: { maxTokens: 1500, temperature: 0.7 },
  'project-consultation': { maxTokens: 2500, temperature: 0.7 },
  // 重量スキル（深い思考・分析）
  brainstorm: { maxTokens: 2500, temperature: 0.8 },
  research: { maxTokens: 2000, temperature: 0.5 },
}

const DEFAULT_CONFIG: SkillModelConfig = {
  maxTokens: 1000,
  temperature: 0.7,
}

/**
 * スキルに応じたAIモデルを返す
 *
 * 将来の切替ポイント:
 * - OPENAI_API_KEY が設定されたら scheduling/task を openai('gpt-4o-mini') に
 * - ANTHROPIC_API_KEY が設定されたら brainstorm/counseling を anthropic('claude-sonnet-4-6') に
 */
export function getModelForSkill(_skillId?: string) {
  void _skillId
  // 将来の切替例:
  // if (process.env.OPENAI_API_KEY && (skillId === 'scheduling' || skillId === 'task')) {
  //   return openai('gpt-4o-mini')
  // }
  // if (process.env.ANTHROPIC_API_KEY && (skillId === 'brainstorm' || skillId === 'counseling')) {
  //   return anthropic('claude-sonnet-4-6')
  // }

  const modelName = resolveGeminiModel()
  return google(modelName)
}

/**
 * スキルに応じた設定を返す
 */
export function getConfigForSkill(skillId?: string): SkillModelConfig {
  if (skillId && skillId in SKILL_CONFIG) {
    return SKILL_CONFIG[skillId]
  }
  return DEFAULT_CONFIG
}

// ============================================================
// Phase A: エージェント向けプロバイダー関数
// ============================================================

export interface AgentModelConfig {
  maxTokens: number
  temperature: number
}

const AGENT_MODEL_MAP: Record<string, AgentModelConfig> = {
  // 軽量エージェント（Gemini Flash で十分）
  orchestrator:      { maxTokens: 500,  temperature: 0.1 },
  'task-executor':   { maxTokens: 1200, temperature: 0.3 },
  'daily-planner':   { maxTokens: 1500, temperature: 0.4 },
  'memory-guardian': { maxTokens: 1000, temperature: 0.3 },
  // 重量エージェント（デフォルト Gemini Flash、将来 Claude/GPT に昇格可能）
  coach:             { maxTokens: 3000, temperature: 0.8 },
  'project-pm':      { maxTokens: 3000, temperature: 0.6 },
  strategist:        { maxTokens: 3000, temperature: 0.6 },
}

/**
 * エージェントに応じたAIモデルを返す
 *
 * 将来の切替ポイント:
 * - ANTHROPIC_API_KEY を設定すると coach/strategist を Claude に昇格可能
 * - AGENT_MODEL_MAP の provider フィールドを変えるだけで全体に反映
 */
export function getModelForAgent(_agentId: AgentId) {
  void _agentId
  // 将来の切替例:
  // if (process.env.ANTHROPIC_API_KEY && ['coach', 'strategist'].includes(_agentId)) {
  //   return anthropic('claude-sonnet-4-6')
  // }
  const modelName = resolveGeminiModel()
  return google(modelName)
}

/**
 * エージェントに応じた設定を返す
 */
export function getConfigForAgent(agentId: AgentId): AgentModelConfig {
  return AGENT_MODEL_MAP[agentId] ?? { maxTokens: 1000, temperature: 0.7 }
}

// ============================================================
// メモ→マインドマップ変換用プロバイダー（デュアル構成）
// ============================================================

export type MemoMindmapMode = 'quick' | 'deep'

/**
 * メモ→マインドマップ変換のモデルを返す。
 * - quick: Gemini Flash-Lite（高速・最安。通常のメモ整理）
 * - deep : DeepSeek V4（論理再構成が重い時）。DEEPSEEK_API_KEY 未設定なら quick へフォールバック
 *
 * 戻り値の modelName はログ（ai_usage）と原価推定に使う。
 */
export function getModelForMemoMindmap(mode: MemoMindmapMode) {
  if (mode === 'deep' && process.env.DEEPSEEK_API_KEY) {
    const modelName = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL
    return { model: deepseek(modelName), modelName }
  }
  const modelName = resolveGeminiModel()
  return { model: google(modelName), modelName }
}
