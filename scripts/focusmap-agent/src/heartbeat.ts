import type { AgentConfig } from './types.js';
import type { AgentApiClient } from './api-client.js';
import { collectCapabilities } from './capabilities.js';
import { error as logError } from './logger.js';

export async function upsertRunner(api: AgentApiClient, config: AgentConfig): Promise<string> {
  const capabilities = await collectCapabilities(config);
  const { runner } = await api.heartbeat({
    hostname: config.hostname,
    display_name: config.display_name ?? `${config.hostname} (Focusmap Lite)`,
    executors: capabilities.executors,
    available_secret_names: capabilities.available_secret_names,
    metadata: capabilities.metadata,
  });
  return runner.id;
}

export function startHeartbeatLoop(
  api: AgentApiClient,
  config: AgentConfig,
  intervalMs = 30_000,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await upsertRunner(api, config);
    } catch (error) {
      logError('heartbeat failed', error);
    }
  }, intervalMs);
}
