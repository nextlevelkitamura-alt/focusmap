import type { AgentApiClient } from './api-client.js';
import type { AiTask } from './types.js';
import { debug, error as logError, info } from './logger.js';

export function startClaimLoop(
  api: AgentApiClient,
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
      const task = await api.claimTask(runnerId);
      if (task) {
        info(`claimed task ${task.id} (skill=${task.skill_id ?? 'none'}, executor=${task.executor})`);
        try {
          await onTask(task);
        } catch (error) {
          logError(`task ${task.id} failed during execution`, error);
        }
      }
    } catch (error) {
      logError('claim loop error', error);
    } finally {
      running = false;
    }
  }, intervalMs);
}
