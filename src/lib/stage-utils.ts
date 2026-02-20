/**
 * タスクの stage（ライフサイクル）自動遷移ロジック
 *
 * stage: 'plan' | 'scheduled' | 'executing' | 'done' | 'archived'
 *
 * 遷移ルール:
 *   plan ─(scheduled_at設定)─> scheduled ─(timer開始)─> executing
 *     ^                          |    ^                    |
 *     └─(scheduled_at解除)───────┘    └─(timer停止)────────┘
 *                                     |
 *                     (status='done') └──> done
 */

import type { Task, TaskStage } from '@/types/database'

/**
 * タスクの現在の状態から正しい stage を計算する
 */
export function computeStage(task: {
  status?: string
  is_timer_running?: boolean
  scheduled_at?: string | null
}): TaskStage {
  if (task.status === 'done') return 'done'
  if (task.is_timer_running) return 'executing'
  if (task.scheduled_at) return 'scheduled'
  return 'plan'
}

/**
 * タスク更新時に stage の自動遷移が必要かを判定し、
 * 必要なら stage を含む追加更新を返す
 *
 * @param updates - 適用しようとしている更新内容
 * @param currentTask - 更新前のタスク状態
 * @returns stage 更新が必要なら { stage: newStage }、不要なら {}
 */
export function deriveStageUpdate(
  updates: Partial<Task>,
  currentTask: Partial<Task>
): { stage?: string } {
  // stage に影響するフィールドが更新に含まれていなければ何もしない
  const stageFields: (keyof Task)[] = ['status', 'is_timer_running', 'scheduled_at']
  const affectsStage = stageFields.some((key) => key in updates)
  if (!affectsStage) return {}

  // 更新後の状態をマージして stage を計算
  const merged = {
    status: (updates.status ?? currentTask.status) as string | undefined,
    is_timer_running:
      updates.is_timer_running ?? currentTask.is_timer_running ?? false,
    scheduled_at:
      'scheduled_at' in updates
        ? updates.scheduled_at
        : currentTask.scheduled_at,
  }

  const newStage = computeStage(merged)
  const currentStage = (currentTask as any).stage as string | undefined

  // 変化がなければ更新不要
  if (newStage === currentStage) return {}

  return { stage: newStage }
}
