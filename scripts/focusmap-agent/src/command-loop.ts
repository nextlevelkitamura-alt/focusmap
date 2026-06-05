import type { AgentApiClient } from './api-client.js';
import type { AgentConfig } from './types.js';
import { executeCommand } from './command-executor.js';
import { debug, error as logError, info } from './logger.js';

const MAX_COMMAND_BACKOFF_MS = 2 * 60_000;

export function startCommandLoop(
  api: AgentApiClient,
  runnerId: string,
  config: AgentConfig,
  intervalMs = 5_000,
): NodeJS.Timeout {
  let running = false;
  let nextAllowedAt = 0;
  let backoffMs = intervalMs;
  return setInterval(async () => {
    const now = Date.now();
    if (now < nextAllowedAt) return;
    if (running) {
      debug('command loop: previous still running, skipping');
      return;
    }
    running = true;
    try {
      const command = await api.claimCommand(runnerId);
      if (!command) return;
      info(`claimed command ${command.id} (${command.type})`);
      try {
        const result = await executeCommand(command, config);
        await api.completeCommand(runnerId, command.id, true, { result });
        info(`command ${command.id} completed`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await api.completeCommand(runnerId, command.id, false, { error: message });
        logError(`command ${command.id} failed`, message);
      }
      backoffMs = intervalMs;
      nextAllowedAt = 0;
    } catch (error) {
      logError('command loop error', error);
      nextAllowedAt = Date.now() + backoffMs;
      backoffMs = Math.min(MAX_COMMAND_BACKOFF_MS, backoffMs * 2);
    } finally {
      running = false;
    }
  }, intervalMs);
}
