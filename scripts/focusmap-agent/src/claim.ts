/**
 * claim_ai_task_for_runner RPC で task を pull
 *
 * Supabase の SQL関数 `claim_ai_task_for_runner` は executor フィルタを内部で実施。
 * 本 agent は executors=['playwright','simple'] を heartbeat で宣言しているため、
 * playwright/simple executor のタスクのみ claim される (codex-rpc-bridge とは衝突しない)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiTask } from './types.js';
import { debug, error as logError, info } from './logger.js';

export async function claimTask(
  supabase: SupabaseClient,
  runnerId: string,
  ttlSec = 300,
): Promise<AiTask | null> {
  const { data, error } = await supabase.rpc('claim_ai_task_for_runner', {
    p_runner_id: runnerId,
    p_claim_ttl_seconds: ttlSec,
  });
  if (error) {
    throw new Error(`claim_ai_task_for_runner failed: ${error.message}`);
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  const task = Array.isArray(data) ? data[0] : data;
  return task as AiTask;
}

export function startClaimLoop(
  supabase: SupabaseClient,
  runnerId: string,
  onTask: (task: AiTask) => Promise<void>,
  intervalMs = 10_000,
): NodeJS.Timeout {
  let running = false;
  return setInterval(async () => {
    if (running) {
      debug('claim loop: previous still running, skipping');
      return;
    }
    running = true;
    try {
      const task = await claimTask(supabase, runnerId);
      if (task) {
        info(`claimed task ${task.id} (skill=${task.skill_id ?? 'none'}, executor=${task.executor})`);
        try {
          await onTask(task);
        } catch (e) {
          logError(`task ${task.id} failed during execution`, e);
        }
      }
    } catch (e) {
      logError('claim loop error', e);
    } finally {
      running = false;
    }
  }, intervalMs);
}
