/**
 * ai_runners テーブルへの upsert (heartbeat)
 *
 * - 初回起動時に runner を登録 (返り値: runner_id)
 * - 以降 30秒ごとに last_heartbeat_at を更新
 * - upsert キーは (user_id, hostname)
 * - executors: ['playwright', 'simple'] を宣言 (既存 codex/codex_app と並走)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from './types.js';
import { error as logError, info } from './logger.js';

const EXECUTORS = ['playwright', 'simple'];

export async function upsertRunner(
  supabase: SupabaseClient,
  config: AgentConfig,
): Promise<string> {
  const { data, error } = await supabase
    .from('ai_runners')
    .upsert(
      {
        user_id: config.user_id,
        hostname: config.hostname,
        display_name: config.display_name ?? `${config.hostname} (focusmap-agent)`,
        executors: EXECUTORS,
        available_repo_keys: [],
        available_secret_names: config.gemini_api_key ? ['GOOGLE_GENERATIVE_AI_API_KEY'] : [],
        metadata: {
          agent: 'focusmap-agent',
          version: '0.1.0',
        },
        last_heartbeat_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,hostname' },
    )
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`ai_runners upsert failed: ${error?.message ?? 'no data'}`);
  }

  // 全所有 space に自動紐付け (まだ未紐付けのものだけ)
  // これにより agent が claim 可能になる
  await ensureRunnerSpacesBindings(supabase, data.id, config.user_id);

  return data.id;
}

/**
 * 起動時に自動で「ユーザー所有の全 space」へ runner を紐付ける。
 * 既存 binding は維持 (ON CONFLICT で no-op)。
 */
async function ensureRunnerSpacesBindings(
  supabase: SupabaseClient,
  runnerId: string,
  userId: string,
): Promise<void> {
  const { data: spaces } = await supabase
    .from('spaces')
    .select('id')
    .eq('user_id', userId);

  if (!spaces || spaces.length === 0) return;

  const rows = spaces.map((s) => ({
    runner_id: runnerId,
    space_id: (s as { id: string }).id,
    enabled: true,
  }));

  const { error } = await supabase
    .from('ai_runner_spaces')
    .upsert(rows, { onConflict: 'runner_id,space_id' });

  if (error) {
    logError('ai_runner_spaces upsert failed', error.message);
  }
}

export function startHeartbeatLoop(
  supabase: SupabaseClient,
  config: AgentConfig,
  intervalMs = 30_000,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await upsertRunner(supabase, config);
    } catch (e) {
      logError('heartbeat failed', e);
    }
  }, intervalMs);
}
