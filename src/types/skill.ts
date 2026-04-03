// Focusmap スキルカード型定義
// AIが実行するスキルの定義と実行状態を管理

/** スキルの介入レベル */
export type ApprovalType = 'auto' | 'confirm' | 'interactive'

/** スキルの実行ステップ */
export interface SkillStep {
  label: string
  /** true = AI自動実行、false = 人間の確認が必要 */
  auto: boolean
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
