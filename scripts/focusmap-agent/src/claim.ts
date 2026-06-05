import type { AgentApiClient } from './api-client.js';
import type { AiTask } from './types.js';
import { debug, error as logError, info } from './logger.js';

const MAX_CLAIM_BACKOFF_MS = 2 * 60_000;

export function startClaimLoop(
  api: AgentApiClient,
  runnerId: string,
  onTask: (task: AiTask) => Promise<void>,
  intervalMs = 10_000,
): NodeJS.Timeout {
  let running = false;
  let nextAllowedAt = 0;
  let backoffMs = intervalMs;
  return setInterval(async () => {
    const now = Date.now();
    if (now < nextAllowedAt) return;
    if (running) {
      debug('claim loop: previous still running, skipping');
      return;
    }
    running = true;
    try {
      const task = await api.claimTask(runnerId);
      if (task) {
        info(`claimed task ${task.id} (skill=${task.skill_id ?? 'none'}, executor=${task.executor})`);
        try {
          await onTask(task);
        } catch (error) {
          logError(`task ${task.id} failed during execution`, error);
        }
      }
      backoffMs = intervalMs;
      nextAllowedAt = 0;
    } catch (error) {
      logError('claim loop error', error);
      nextAllowedAt = Date.now() + backoffMs;
      backoffMs = Math.min(MAX_CLAIM_BACKOFF_MS, backoffMs * 2);
    } finally {
      running = false;
    }
  }, intervalMs);
}
