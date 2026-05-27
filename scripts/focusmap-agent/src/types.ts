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
  result?: Record<string, unknown> | null;
}

export interface StepLog {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  at?: string;
  detail?: string;
}

export interface TaskResultJson {
  executor: 'playwright' | 'simple' | 'browser' | 'terminal';
  steps: StepLog[];
  output: string;
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    model: string;
  };
  meta?: Record<string, unknown>;
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
