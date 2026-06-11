/**
 * focusmap-agent: 共通型定義
 *
 * Supabase の ai_tasks / ai_runners / ai_task_packages テーブルの構造に対応。
 */

export interface AgentConfig {
  /** Legacy fields kept for local dev only. User installs must not require these. */
  user_id?: string;
  supabase_url?: string;
  supabase_service_role_key?: string;
  /** ホスト名 (ai_runners.hostname、 user_id と組み合わせて unique) */
  hostname: string;
  /** 表示名 (任意) */
  display_name?: string;
  /** Focusmap Lite agent token. Service role key はMacへ置かない。 */
  agent_token: string;
  /** Gemini API key (Google AI Studio) */
  gemini_api_key?: string;
  /** DeepSeek API key (optional) */
  deepseek_api_key?: string;
  /** API base URL */
  api_url?: string;
  /** Shell execution toggle. Destructive patterns are still blocked. */
  shell_enabled?: boolean;
  /** Extra PATH for launchd environments. */
  path?: string;
}

export type AiTaskStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'needs_input'
  | 'completed'
  | 'failed';

export interface AiTask {
  id: string;
  user_id: string;
  space_id: string | null;
  prompt: string;
  skill_id: string | null;
  approval_type: 'auto' | 'confirm' | 'interactive';
  status: AiTaskStatus;
  executor: string;
  package_id?: string | null;
  package_snapshot?: Record<string, unknown> | null;
  parent_task_id?: string | null;
  scheduled_at?: string | null;
  cwd?: string | null;
  source_task_id?: string | null;
  source_note_id?: string | null;
  source_ideal_goal_id?: string | null;
  codex_thread_id?: string | null;
  codex_resume_thread_id?: string | null;
  result?: Record<string, unknown> | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface StepLog {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  at?: string;
  detail?: string;
}

export interface AgentActivityMessage {
  role: 'system' | 'codex' | 'user' | 'status';
  kind:
    | 'prompt_waiting'
    | 'sent'
    | 'progress'
    | 'question'
    | 'approval'
    | 'resumed'
    | 'completed'
    | 'failed'
    | 'user_answer';
  body: string;
  importance?: 'normal' | 'important';
  metadata?: Record<string, unknown>;
  dedupe_key?: string;
  dedupeKey?: string;
  created_at?: string;
  createdAt?: string;
}

export interface TaskResultJson {
  executor: 'playwright' | 'simple' | 'browser' | 'terminal' | 'codex' | 'codex_app';
  steps: StepLog[];
  output: string;
  error?: string;
  live_log?: string;
  message?: string;
  current_step?: string;
  codex_thread_id?: string;
  codex_thread_url?: string;
  codex_run_state?: 'running' | 'awaiting_approval';
  codex_review_reason?: string;
  codex_source_task_completed?: boolean;
  codex_source_task_id?: string | null;
  codex_source_task_completion_reason?: string | null;
  codex_source_task_completion_suppressed?: boolean;
  codex_archive_request_state?: 'waiting_for_grace' | 'pending' | 'completed' | 'cancelled';
  codex_archive_requested_at?: string | null;
  codex_archive_request_reason?: string | null;
  codex_archive_completed_at?: string | null;
  codex_archive_request_cancelled_at?: string | null;
  last_activity_at?: string;
  awaiting_approval_at?: string;
  codex_visible_messages?: AgentActivityMessage[];
  activity_messages?: AgentActivityMessage[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    model: string;
  };
  meta?: Record<string, unknown>;
}

export interface CodexThreadImportPayload {
  id: string;
  title?: string | null;
  preview?: string | null;
  first_user_message?: string | null;
  cwd?: string | null;
  updated_at_ms?: number | null;
}

export interface CodexThreadImportScope {
  project_id: string;
  space_id?: string | null;
  repo_path: string;
  enabled_since?: string | null;
}

export interface AgentCommand {
  id: string;
  runner_id: string;
  user_id: string;
  space_id: string | null;
  task_id: string | null;
  type:
    // legacy command types (Phase A-E)
    | 'open_url'
    | 'open_google_auth'
    | 'open_gws_auth'
    | 'open_browser_auth'
    | 'run_shell'
    | 'restart_agent'
    | 'pause_agent'
    | 'resume_agent'
    | 'upload_logs'
    | 'scan_capabilities'
    // Phase F: Claude Code 級の自由実行
    | 'file_read'
    | 'file_write'
    | 'file_list'
    | 'file_delete'
    | 'browser_navigate'
    | 'browser_click'
    | 'browser_fill'
    | 'browser_screenshot'
    | 'browser_text'
    | 'browser_close_session'
    | 'cancel_command';
  payload: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
}
