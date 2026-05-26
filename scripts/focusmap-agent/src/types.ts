/**
 * focusmap-agent: 共通型定義
 *
 * Supabase の ai_tasks / ai_runners / ai_task_packages テーブルの構造に対応。
 */

export interface AgentConfig {
  /** ユーザーID (Workspace所属) */
  user_id: string;
  /** ホスト名 (ai_runners.hostname、 user_id と組み合わせて unique) */
  hostname: string;
  /** 表示名 (任意) */
  display_name?: string;
  /** Supabase URL (NEXT_PUBLIC_SUPABASE_URL) */
  supabase_url: string;
  /** Supabase service role key */
  supabase_service_role_key: string;
  /** Gemini API key (Google AI Studio) */
  gemini_api_key?: string;
  /** API base URL (現状未使用、将来 BYOK API endpoint等に) */
  api_url?: string;
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
  executor: 'playwright' | 'simple';
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
