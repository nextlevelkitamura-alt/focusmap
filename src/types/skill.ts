// Focusmap スキルカード型定義
// AIが実行するスキルの定義と実行状態を管理

/** スキルの介入レベル */
export type ApprovalType = 'auto' | 'confirm' | 'interactive'

/** モデル選定の tier
 * - simple: Gemini Flash-Lite 等の激安モデル (要約・分類・整理)
 * - agent: DeepSeek V4 Pro 等のエージェント特化モデル (Browser automation / Tool use)
 * - mixed: ステップ毎に切替
 */
export type ModelTier = 'simple' | 'agent' | 'mixed'

/** スキルの実行ステップ */
export interface SkillStep {
  label: string
  /** true = AI自動実行、false = 人間の確認が必要 */
  auto: boolean
  /** ステップ毎の tier override (省略時はスキル全体の model_tier を継承) */
  model_tier?: ModelTier
}

/** スキル定義（静的データ） */
export interface FocusmapSkill {
  id: string
  name: string
  description: string
  icon: string
  approval_type: ApprovalType
  steps: SkillStep[]
  /** cron式 or null（手動実行のみ） */
  schedule: string | null
  prompt_template: string
  /** 採用モデルの種別 (デフォルト simple) */
  model_tier?: ModelTier
  /** スキルのカテゴリ */
  category?: string
  /** 1実行の推定原価 (USD) */
  estimated_cost_usd?: number
  /** 1実行の推定所要秒数 */
  estimated_duration_sec?: number
}

/** 各ステップの実行状態 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed'

/** タスクの実行状態 */
export type TaskStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'needs_input'
  | 'completed'
  | 'failed'

/** スキルの実行状態（動的データ） */
export interface SkillExecution {
  skillId: string
  status: TaskStatus
  currentStep: number
  stepStatuses: StepStatus[]
  lastRunAt: string | null
  error: string | null
}
