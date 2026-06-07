import type { AgentConfig } from './types.js';
import type { AgentApiClient } from './api-client.js';
import { collectCapabilities } from './capabilities.js';
import { error as logError } from './logger.js';

const MAX_HEARTBEAT_BACKOFF_MS = 5 * 60_000;
const FULL_REGISTRATION_ACTIVE_INTERVAL_MS = 60_000;
const FULL_REGISTRATION_IDLE_INTERVAL_MS = 10 * 60_000;

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
  runnerId: string,
  activeIntervalMs = 10_000,
  getCurrentTaskId: () => string | null = () => null,
  idleIntervalMs = activeIntervalMs,
): NodeJS.Timeout {
  const tickIntervalMs = Math.max(1_000, Math.min(activeIntervalMs, idleIntervalMs));
  let nextAllowedAt = 0;
  let nextHeartbeatAt = 0;
  let backoffMs = activeIntervalMs;
  let lastTaskId: string | null = null;
  let lastFullRegistrationAt = Date.now();
  return setInterval(async () => {
    const now = Date.now();
    if (now < nextAllowedAt) return;
    const currentTaskId = getCurrentTaskId();
    const intervalMs = currentTaskId ? activeIntervalMs : idleIntervalMs;
    const fullRegistrationIntervalMs = currentTaskId
      ? FULL_REGISTRATION_ACTIVE_INTERVAL_MS
      : FULL_REGISTRATION_IDLE_INTERVAL_MS;
    const becameActive = !!currentTaskId && currentTaskId !== lastTaskId;
    if (!becameActive && now < nextHeartbeatAt) return;
    try {
      await api.runnerHeartbeat({
        runner_id: runnerId,
        hostname: config.hostname,
        device_id: config.hostname,
        status: 'online',
        current_task_id: currentTaskId,
        metadata: {
          app: 'focusmap-lite',
          heartbeat_kind: 'liveness',
          agent_state: currentTaskId ? 'running' : 'idle',
        },
      });
      if (now - lastFullRegistrationAt >= fullRegistrationIntervalMs) {
        await upsertRunner(api, config);
        lastFullRegistrationAt = now;
      }
      lastTaskId = currentTaskId;
      backoffMs = intervalMs;
      nextHeartbeatAt = Date.now() + intervalMs;
      nextAllowedAt = 0;
    } catch (error) {
      if (now - lastFullRegistrationAt >= fullRegistrationIntervalMs) {
        try {
          await upsertRunner(api, config);
          lastFullRegistrationAt = Date.now();
          backoffMs = intervalMs;
          nextHeartbeatAt = Date.now() + intervalMs;
          nextAllowedAt = 0;
          return;
        } catch {
          logError('heartbeat failed', error);
        }
      }
      nextAllowedAt = Date.now() + Math.min(backoffMs, fullRegistrationIntervalMs);
      backoffMs = Math.min(MAX_HEARTBEAT_BACKOFF_MS, backoffMs * 2);
    }
  }, tickIntervalMs);
}
