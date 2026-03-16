/**
 * エージェント基盤 型定義
 * Phase A: 後方互換エージェントアーキテクチャの土台
 */

export type AgentId =
  | 'orchestrator'
  | 'coach'
  | 'project-pm'
  | 'daily-planner'
  | 'strategist'
  | 'task-executor'    // 既存6スキルを束ねる後方互換エージェント
  | 'memory-guardian'

export interface AgentContext {
  agentId: AgentId
  userId: string
  message: string
  projectId?: string
  contextLayers?: {
    layer4_vision?: string    // personality/purpose（月1更新）
    layer3_project?: string   // project_purpose/project_insights（週1更新）
    layer2_task?: string      // situation/project_status（毎日更新）
    layer1_session?: string   // チャット履歴（リアルタイム）
  }
}

export interface AgentResult {
  agentId: AgentId
  skillId?: string            // task-executor の場合のみ使用（既存スキルID）
  response?: string
  suggestionsForContext?: string[]
  continueOptions?: string[]
}
