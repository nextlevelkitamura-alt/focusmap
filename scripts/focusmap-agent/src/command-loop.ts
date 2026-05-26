import type { AgentApiClient } from './api-client.js';
import type { AgentConfig } from './types.js';
import { executeCommand } from './command-executor.js';
import { debug, error as logError, info } from './logger.js';

export function startCommandLoop(
  api: AgentApiClient,
  runnerId: string,
  config: AgentConfig,
  intervalMs = 5_000,
): NodeJS.Timeout {
  let running = false;
  return setInterval(async () => {
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
    } catch (error) {
      logError('command loop error', error);
    } finally {
      running = false;
    }
  }, intervalMs);
}
