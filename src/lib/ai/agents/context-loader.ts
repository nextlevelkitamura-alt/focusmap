/**
 * 4層コンテキストローダー
 * Phase A: 既存の loadContextFromDocuments() をラップし、
 * エージェントごとに必要な層だけ返す
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { loadContextFromDocuments } from '../context/document-context'
import type { AgentId, AgentContext } from './index'

type LayerKey = 'layer4' | 'layer3' | 'layer2' | 'layer1'

/** エージェントごとに必要な層の定義 */
const AGENT_LAYER_MAP: Record<AgentId, LayerKey[]> = {
  orchestrator:      ['layer2'],
  'task-executor':   ['layer2', 'layer3'],
  coach:             ['layer4', 'layer2'],
  'project-pm':      ['layer3', 'layer2'],
  'daily-planner':   ['layer2', 'layer1'],
  strategist:        ['layer4', 'layer3'],
  'memory-guardian': ['layer4', 'layer3', 'layer2'],
}

/**
 * エージェントIDに応じた4層コンテキストを返す
 *
 * 現在は loadContextFromDocuments() の結果をマッピングするだけ。
 * Phase C でフォルダ/ドキュメント型の詳細フィルタを追加予定。
 */
export async function loadContextForAgent(
  supabase: SupabaseClient,
  agentId: AgentId,
  userId: string,
  _projectId?: string,
): Promise<AgentContext['contextLayers']> {
  const requiredLayers = AGENT_LAYER_MAP[agentId]

  // 既存ローダーで全コンテキスト取得
  const injection = await loadContextFromDocuments(supabase, userId)

  const result: AgentContext['contextLayers'] = {}

  // Layer 4: ビジョン層（personality / purpose）
  if (requiredLayers.includes('layer4')) {
    const parts: string[] = []
    if (injection.userContextCategories.life_personality) {
      parts.push(`[性格・価値観]\n${injection.userContextCategories.life_personality}`)
    }
    if (injection.userContextCategories.life_purpose) {
      parts.push(`[目標・ビジョン]\n${injection.userContextCategories.life_purpose}`)
    }
    if (parts.length > 0) {
      result.layer4_vision = parts.join('\n\n')
    }
  }

  // Layer 3: プロジェクト層
  if (requiredLayers.includes('layer3')) {
    if (injection.projectContext) {
      result.layer3_project = injection.projectContext
    }
  }

  // Layer 2: タスク層（現在の状況）
  if (requiredLayers.includes('layer2')) {
    const parts: string[] = []
    if (injection.userContextCategories.current_situation) {
      parts.push(injection.userContextCategories.current_situation)
    }
    if (injection.freshnessAlerts) {
      parts.push(injection.freshnessAlerts)
    }
    if (parts.length > 0) {
      result.layer2_task = parts.join('\n\n')
    }
  }

  // Layer 1: セッション層（チャット履歴はルーター側で付与するため空）
  // Phase D で daily-planner が使用する際に実装予定

  return result
}
