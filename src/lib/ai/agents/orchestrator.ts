/**
 * Orchestrator（指揮官）
 * Phase A: 既存の routeToSkill() をラップし、エージェントIDにマッピング
 *
 * 後方互換性:
 * - agentId='task-executor' のとき、chat/route.ts は既存の skillId ベースパスを通る
 * - Phase B 以降で coach/project-pm 用の独自処理を追加予定
 */

import { routeToSkill } from '../router'
import type { AgentId, AgentResult } from './index'

/** スキルID → エージェントID マッピング */
const SKILL_TO_AGENT: Record<string, AgentId> = {
  scheduling:             'task-executor',
  task:                   'task-executor',
  memo:                   'task-executor',
  counseling:             'coach',
  'project-consultation': 'project-pm',
  brainstorm:             'coach',   // Phase B で専用エージェント化予定
}

/**
 * メッセージとオプションのスキルIDを受け取り、担当エージェントを決定する
 *
 * @param message - ユーザーのメッセージ
 * @param explicitSkillId - UIから明示されたスキルID（省略可）
 * @returns AgentResult（agentId + skillId）
 */
export function orchestrate(message: string, explicitSkillId?: string): AgentResult {
  // 1. UIから明示されたスキルIDを優先、なければ自然言語判定
  const skillId = explicitSkillId ?? routeToSkill(message) ?? undefined

  // 2. スキルID → エージェントID に変換
  if (skillId && skillId in SKILL_TO_AGENT) {
    return {
      agentId: SKILL_TO_AGENT[skillId],
      skillId,
    }
  }

  // 3. スコア不足（ルーターが null を返した場合）
  // Phase A ではスキルセレクタ表示のために skillId=undefined を返す
  // chat/route.ts 側で既存の「スキル未選択」フローに入る
  return {
    agentId: 'orchestrator',
    skillId: undefined,
  }
}
