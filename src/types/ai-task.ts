// ai_tasks テーブルの型定義

export type AiTaskApprovalType = 'auto' | 'confirm' | 'interactive'

export type AiTaskStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'needs_input'
  | 'completed'
  | 'failed'

export interface AiTask {
  id: string
  user_id: string
  prompt: string
  skill_id: string | null
  approval_type: AiTaskApprovalType
  status: AiTaskStatus
  result: Record<string, unknown> | null
  error: string | null
  parent_task_id: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}
