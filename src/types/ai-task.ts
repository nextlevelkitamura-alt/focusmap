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
  /** スケジュール実行時刻（NULLなら即時実行） */
  scheduled_at: string | null
  /** 繰り返しcron式（例: "0 9 * * *"）*/
  recurrence_cron: string | null
  /** 作業ディレクトリ（特定リポのスキルを実行する場合） */
  cwd: string | null
  /** notes テーブルから起動された場合の元メモID（旧UI用） */
  source_note_id: string | null
  /** ideal_goals テーブルのメモから起動された場合の元アイテムID */
  source_ideal_goal_id: string | null
  /** claude --remote-control が発行する claude.ai/code セッションURL */
  remote_session_url: string | null
  /** tmux セッション名（後から attach / kill に使用） */
  tmux_session_name: string | null
  /**
   * 実行 AI エージェント
   * - 'claude': Claude Code Remote Control (tmux内、スマホアプリ接続)
   * - 'codex': Codex CLI headless (codex exec、ライブログ捕捉)
   * - 'codex_app': Codex.app を Mac で起動（codex:// URL）+ thread DB 追跡
   */
  executor: 'claude' | 'codex' | 'codex_app'
  /** Codex.app の thread ID (~/.codex/state_5.sqlite) */
  codex_thread_id: string | null
}
